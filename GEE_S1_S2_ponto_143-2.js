// ============================================================================
//  SENTINEL-2 + SENTINEL-1 | Ponto central 143/2 (CRP-42)
//  Cena mais recente, filtros de data/nuvem, mudança em radar e exportação
//  SIRGAS 2000 / UTM 23S (EPSG:31983)
// ============================================================================

// ============================================================
// 0) CONFIGURAÇÃO (edite só este bloco)
// ============================================================
var CONFIG = {
  // --- Ponto central (KMZ 1432.kmz) ---
  pontoNome: '143/2 (CRP-42)',
  pontoLonLat: [-47.1711045636256, -7.77501278808614],
  sufixoArquivo: '143-2',        // usado no nome dos GeoTIFFs

  // --- Datas ('AAAA-MM-DD') ---
  dataInicio: '2026-08-15',
  dataFim: null,                 // null = até hoje

  // --- Nuvem (Sentinel-2) ---
  nuvemCenaMax: 100,             // % máx. de nuvem da CENA (100 = sem filtro)
  usarNuvemPonto: true,          // filtra pela nuvem NO PONTO (Cloud Score+)
  nuvemPontoMin: 0.60,           // 0 = nuvem/sombra, 1 = céu limpo
  aceitarSemCS: true,            // mantém cenas ainda sem Cloud Score+ (muito recentes)
  usarFallback: true,            // se o filtro no ponto zerar, usa as cenas sem esse filtro

  // --- Escolha da cena S2 ---
  ordenarPor: 'data',            // 'data' = mais recente | 'nuvem' = mais limpa no ponto

  // --- Sentinel-1 ---
  bufferS1_m: 5000,              // raio do ROI em torno do ponto central (m)
  compararAnoAnterior: true,     // true: mesmo período do ano anterior | false: 30 dias antes
  limiarPerdaVH_dB: -3,          // ΔVH abaixo disso = candidato a perda de vegetação

  // --- Visualização ---
  zoomInicial: 13,
  s1Visivel: true,               // liga o S1 RGB ao abrir
  s1CenaInteira: true,           // true = cena S1 completa | false = só o ROI
  s1Opacidade: 1.0,              // 0 a 1 (ex.: 0.6 para ver o S2 por baixo)
  compararLadoALado: true,       // cortina: S2 à esquerda, S1 à direita

  // --- Exportação ---
  exportarS2CenaInteira: false,  // false = recorta S2 no ROI (arquivo menor)
  pastaDrive: 'GEE_Exports',
  crs: 'EPSG:31983'              // SIRGAS 2000 / UTM 23S (48°W a 42°W)
};

// ============================================================
// 1) PONTO CENTRAL, ROI E PERÍODO
// ============================================================
var ponto = ee.Geometry.Point(CONFIG.pontoLonLat);
var roi   = ponto.buffer(CONFIG.bufferS1_m).bounds();   // quadrado centrado no ponto

var inicio = ee.Date(CONFIG.dataInicio);
var fim    = CONFIG.dataFim ? ee.Date(CONFIG.dataFim) : ee.Date(Date.now());
var fimInc = fim.advance(1, 'day');                     // inclui o dia final
print('Ponto central:', CONFIG.pontoNome, CONFIG.pontoLonLat);
print('Período:', inicio.format('YYYY-MM-dd'), 'até', fim.format('YYYY-MM-dd'));

// ============================================================
// 2) SENTINEL-2 (L2A + L1C) COM CLOUD SCORE+ NO PONTO
// ============================================================
var bandasS2 = ['B2','B3','B4','B8'];
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

// Lê o Cloud Score+ no pixel do ponto (sem valor => -1)
function addCsPonto(img) {
  var cs = img.select(['cs_cdf']).reduceRegion({
    reducer: ee.Reducer.first(), geometry: ponto, scale: 10
  }).get('cs_cdf');
  return img.set('cs_ponto', ee.Number(ee.Algorithms.If(cs, cs, -1)));
}

// Prepara cada coleção SEPARADAMENTE (o link com o CS+ precisa vir antes do merge)
function prepS2(id, nivel) {
  return ee.ImageCollection(id)
    .filterBounds(ponto)
    .filterDate(inicio, fimInc)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', CONFIG.nuvemCenaMax))
    .linkCollection(csPlus, ['cs_cdf'])
    .map(function(img) {
      var chave = img.date().format('YYYYMMddHHmm').cat('_').cat(img.get('MGRS_TILE'));
      return addCsPonto(img)
        .select(bandasS2)
        .set({nivel: nivel, chave: chave});
    });
}

var l2a = prepS2('COPERNICUS/S2_SR_HARMONIZED', 'L2A (SR)');
var l1c = prepS2('COPERNICUS/S2_HARMONIZED',    'L1C (TOA)');

// Remove duplicatas: mesma passagem em L2A e L1C => fica a L2A
var l1cSemPar = l1c.filter(ee.Filter.inList('chave', l2a.aggregate_array('chave')).not());
var s2Todas = l2a.merge(l1cSemPar);

// Filtro de nuvem no ponto
var filtroPonto = CONFIG.aceitarSemCS
  ? ee.Filter.or(ee.Filter.gte('cs_ponto', CONFIG.nuvemPontoMin),
                 ee.Filter.eq('cs_ponto', -1))
  : ee.Filter.gte('cs_ponto', CONFIG.nuvemPontoMin);
var s2Filtrada = CONFIG.usarNuvemPonto ? s2Todas.filter(filtroPonto) : s2Todas;

// Contagens no lado cliente (decide sem quebrar o script)
var nTodas    = s2Todas.size().getInfo();
var nFiltrada = s2Filtrada.size().getInfo();
print('S2 cenas (após nuvem da cena):', nTodas,
      '| L2A:', l2a.size(), '| L1C sem par L2A:', l1cSemPar.size());
print('S2 cenas (após nuvem no ponto):', nFiltrada);

var s2Col = null;
if (nFiltrada > 0) {
  s2Col = s2Filtrada;
} else if (nTodas > 0 && CONFIG.usarFallback) {
  print('⚠ Nenhuma cena com o ponto limpo. Fallback: usando cenas sem esse filtro.');
  s2Col = s2Todas;
} else {
  print('⚠ Nenhuma cena S2. Amplie as datas ou relaxe nuvemCenaMax/nuvemPontoMin.');
}

var s2Img = null, s2Data = null;
if (s2Col) {
  s2Col = (CONFIG.ordenarPor === 'nuvem')
    ? s2Col.sort('cs_ponto', false)
    : s2Col.sort('system:time_start', false);

  print('S2 - top 10 cenas:', ee.FeatureCollection(s2Col.limit(10).map(function(i) {
    return ee.Feature(null, {
      data: i.date().format('YYYY-MM-dd HH:mm'),
      nivel: i.get('nivel'),
      tile: i.get('MGRS_TILE'),
      nuvem_cena_pct: i.get('CLOUDY_PIXEL_PERCENTAGE'),
      limpeza_no_ponto: i.get('cs_ponto')          // -1 = sem Cloud Score+
    });
  })));

  s2Img  = ee.Image(s2Col.first());
  s2Data = s2Img.date();
  print('S2 selecionada:', s2Data.format('YYYY-MM-dd HH:mm'), s2Img.get('nivel'),
        '| Tile:', s2Img.get('MGRS_TILE'),
        '| Nuvem cena (%):', s2Img.get('CLOUDY_PIXEL_PERCENTAGE'),
        '| Limpeza no ponto:', s2Img.get('cs_ponto'));
}

// ============================================================
// 3) SENTINEL-1 GRD (IW, VV+VH) — radar, não sofre com nuvem
// ============================================================
var s1Base = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(ponto)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

// Filtro de speckle (mediana focal ~30 m); sempre devolve ee.Image
function speckle(img) {
  return ee.Image(img.select(['VV','VH'])
    .focalMedian(30, 'circle', 'meters')
    .copyProperties(img, ['system:time_start']));
}

var s1Periodo = s1Base.filterDate(inicio, fimInc).sort('system:time_start', false);
var nS1 = s1Periodo.size().getInfo();
print('S1 cenas no período:', nS1);

var s1Img = null, s1Data = null, dVH = null, dVV = null;
if (nS1 > 0) {
  print('S1 - top 10 cenas:', ee.FeatureCollection(s1Periodo.limit(10).map(function(i) {
    return ee.Feature(null, {
      data: i.date().format('YYYY-MM-dd HH:mm'),
      passagem: i.get('orbitProperties_pass'),
      orbita_relativa: i.get('relativeOrbitNumber_start'),
      plataforma: i.get('platform_number')
    });
  })));

  s1Img  = ee.Image(s1Periodo.first());
  s1Data = s1Img.date();
  var passagem  = s1Img.get('orbitProperties_pass');
  var orbitaRel = s1Img.get('relativeOrbitNumber_start');
  print('S1 selecionada:', s1Data.format('YYYY-MM-dd HH:mm'), passagem, '| Órbita:', orbitaRel);
  if (s2Data) print('Defasagem S1 x S2 (dias):', s1Data.difference(s2Data, 'day').abs());

  // --- Mudança em radar: SEMPRE mesma órbita relativa e passagem ---
  var mesmaGeom = s1Base
    .filter(ee.Filter.eq('relativeOrbitNumber_start', orbitaRel))
    .filter(ee.Filter.eq('orbitProperties_pass', passagem));

  var refIni = CONFIG.compararAnoAnterior ? inicio.advance(-1, 'year') : inicio.advance(-30, 'day');
  var refFim = CONFIG.compararAnoAnterior ? fimInc.advance(-1, 'year') : inicio;

  var colAtual = mesmaGeom.filterDate(inicio, fimInc);
  var colRef   = mesmaGeom.filterDate(refIni, refFim);
  var nRef = colRef.size().getInfo();
  print('S1 p/ mudança — cenas atuais:', colAtual.size(), '| referência:', nRef);

  if (nRef > 0) {
    var s1Atual = colAtual.map(speckle).median();
    var s1Ref   = colRef.map(speckle).median();
    dVH = s1Atual.select('VH').subtract(s1Ref.select('VH')).rename('dVH');
    dVV = s1Atual.select('VV').subtract(s1Ref.select('VV')).rename('dVV');
  } else {
    print('⚠ Sem cenas de referência na mesma órbita. ΔVH/ΔVV não calculados.');
  }
} else {
  print('⚠ Nenhuma cena S1 no período. Amplie as datas.');
}

// ============================================================
// 4) VISUALIZAÇÃO (mapa centrado no ponto 143/2)
// ============================================================
var visS2nat = {bands:['B4','B3','B2'], min:0, max:3000};
var visS2fc  = {bands:['B8','B4','B3'], min:0, max:4500};
var visVV    = {min:-20, max:0};
var visVH    = {min:-25, max:-5};
var visS1rgb = {min:[-20,-25,3], max:[0,-5,20]};
var visDVH   = {min:-6, max:6, palette:['#b2182b','#f7f7f7','#2166ac']};

function areaS1(img) { return CONFIG.s1CenaInteira ? img : img.clip(roi); }

// Composição RGB do S1: R = VV, G = VH, B = VV-VH
function rgbS1(img) {
  var f = speckle(img);
  return areaS1(ee.Image.cat([
    f.select('VV'), f.select('VH'),
    f.select('VV').subtract(f.select('VH')).rename('VV_VH')
  ]));
}

function camadasS2(mapa) {
  if (!s2Img) return;
  mapa.addLayer(s2Img, visS2nat, 'S2 cor natural');
  mapa.addLayer(s2Img, visS2fc,  'S2 falsa-cor', false);
}
function camadasS1(mapa, ligado, opacidade) {
  if (!s1Img) return;
  var f = areaS1(speckle(s1Img));
  mapa.addLayer(f.select('VV'), visVV, 'S1 VV (dB)', false);
  mapa.addLayer(f.select('VH'), visVH, 'S1 VH (dB)', false);
  mapa.addLayer(rgbS1(s1Img), visS1rgb, 'S1 RGB (VV, VH, VV-VH)', ligado, opacidade);
  if (dVH) {
    mapa.addLayer(dVH.clip(roi), visDVH, 'ΔVH (dB): vermelho = queda', false);
    mapa.addLayer(dVH.lt(CONFIG.limiarPerdaVH_dB).selfMask().clip(roi),
                  {palette: 'red'}, 'ΔVH abaixo do limiar', false);
  }
}
function camadasRef(mapa) {
  mapa.addLayer(roi, {color: 'yellow'}, 'ROI', false);
  mapa.addLayer(ponto, {color: 'red'}, 'Ponto ' + CONFIG.pontoNome);
}

if (CONFIG.compararLadoALado && s2Img && s1Img) {
  // --- Cortina: S2 à esquerda, S1 à direita, zoom sincronizado ---
  var mapaEsq = ui.Map();
  var mapaDir = ui.Map();
  camadasS2(mapaEsq);  camadasRef(mapaEsq);
  camadasS1(mapaDir, true, 1.0);  camadasRef(mapaDir);

  mapaEsq.add(ui.Label(CONFIG.pontoNome + ' | S2 — ' +
                       s2Data.format('dd/MM/YYYY HH:mm').getInfo(),
                       {position: 'top-left', fontWeight: 'bold'}));
  mapaDir.add(ui.Label('S1 — ' + s1Data.format('dd/MM/YYYY HH:mm').getInfo(),
                       {position: 'top-right', fontWeight: 'bold'}));

  ui.Map.Linker([mapaEsq, mapaDir]);
  ui.root.widgets().reset([ui.SplitPanel({
    firstPanel: mapaEsq, secondPanel: mapaDir, wipe: true, style: {stretch: 'both'}
  })]);
  mapaEsq.centerObject(ponto, CONFIG.zoomInicial);
} else {
  camadasS2(Map);
  camadasS1(Map, CONFIG.s1Visivel, CONFIG.s1Opacidade);
  camadasRef(Map);
  Map.centerObject(ponto, CONFIG.zoomInicial);
}

// ============================================================
// 5) EXPORTAÇÕES (SIRGAS 2000 / UTM 23S, 10 m) — aba Tasks > RUN
// ============================================================
var suf = CONFIG.sufixoArquivo;

if (s2Img) {
  var dS2 = s2Data.format('YYYYMMdd').getInfo();
  Export.image.toDrive({
    image: CONFIG.exportarS2CenaInteira ? s2Img.toUint16() : s2Img.toUint16().clip(roi),
    description: 'S2_' + suf + '_' + dS2,
    folder: CONFIG.pastaDrive,
    region: CONFIG.exportarS2CenaInteira ? s2Img.geometry() : roi,
    scale: 10, crs: CONFIG.crs, maxPixels: 1e10
  });
}
if (s1Img) {
  var dS1 = s1Data.format('YYYYMMdd').getInfo();
  Export.image.toDrive({
    image: s1Img.select(['VV','VH']).toFloat().clip(roi),   // dB, sem filtro de speckle
    description: 'S1_' + suf + '_' + dS1,
    folder: CONFIG.pastaDrive,
    region: roi, scale: 10, crs: CONFIG.crs, maxPixels: 1e9
  });
  if (dVH) {
    Export.image.toDrive({
      image: ee.Image.cat([dVH, dVV]).toFloat().clip(roi),
      description: 'S1_dVH_dVV_' + suf + '_' + dS1,
      folder: CONFIG.pastaDrive,
      region: roi, scale: 10, crs: CONFIG.crs, maxPixels: 1e9
    });
  }
}
