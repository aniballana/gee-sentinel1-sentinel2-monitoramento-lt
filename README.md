GEE Sentinel-1 + Sentinel-2 for linear infrastructure monitoring

A Google Earth Engine (JavaScript) script that combines optical (Sentinel-2) and radar (Sentinel-1) imagery to monitor linear infrastructure such as transmission lines and substations.

Why combine optical and radar?
Sentinel-2 (optical): shows what the eye recognizes: vegetation, bare soil, tower pads and access roads. Affected by clouds.
Sentinel-1 (C-band radar): sees through clouds and responds to the structure and moisture of the target. It complements optical data exactly when optical fails.

Neither one solves everything alone. Read together, the interpretation becomes more reliable.

What the script does
Defines a point of interest and a square ROI around it.
Finds the latest Sentinel-2 scene (L2A and L1C, without duplicates), with cloud filtering on the whole scene and at the point pixel (Cloud Score+).
Finds the latest Sentinel-1 scene (GRD, IW mode, VV + VH).
Computes radar change (ΔVH and ΔVV), comparing the current period with the same period last year, always on the same relative orbit and pass direction.
Displays layers on the map, with an optional side-by-side swipe (S2 left, S1 right).
Exports GeoTIFFs to Google Drive, ready for QGIS or ArcGIS.
How to use
You need a Google Earth Engine account.
Open the Code Editor and create a new script.
Paste the contents of gee_s1_s2_monitoramento.js.
Edit only the CONFIG block at the top:
pontoLonLat: [longitude, latitude] in decimal degrees (WGS 84).
dataInicio and dataFim: search period (dataFim: null = until today).
nuvemCenaMax, usarNuvemPonto, nuvemPontoMin: cloud filters.
crs: see the table below.
Click Run and follow the Console.
To export, open the Tasks tab and click RUN on each file.

Parameter names are in Portuguese (original project language).

Coordinate reference system (SIRGAS 2000 / UTM, Brazil)
Point longitude	Zone	EPSG
54° W to 48° W	22S	EPSG:31982
48° W to 42° W	23S	EPSG:31983
42° W to 36° W	24S	EPSG:31984
Main parameters
Parameter	Purpose
nuvemCenaMax	Max cloud % of the whole scene (100 = no filter)
usarNuvemPonto / nuvemPontoMin	Filters by point-pixel cleanliness (0 = cloud, 1 = clear)
aceitarSemCS	Keeps very recent scenes that don't have Cloud Score+ yet
ordenarPor	'data' (most recent) or 'nuvem' (clearest at the point)
bufferS1_m	ROI radius for analysis and export (m)
compararAnoAnterior	ΔVH baseline: same period last year, or 30 days before
limiarPerdaVH_dB	ΔVH threshold to flag possible vegetation loss
compararLadoALado	Enables the S2 | S1 swipe
exportarS2CenaInteira	Exports the full S2 scene or only the ROI
Outputs
S2_<suffix>_<date>.tif: Sentinel-2 (B2, B3, B4, B8), 10 m.
S1_<suffix>_<date>.tif: Sentinel-1 (VV, VH) in dB, no speckle filter.
S1_dVH_dVV_<suffix>_<date>.tif: radar change (dB).
Reading the radar (RGB: VV, VH, VV-VH)
Appearance	Likely meaning
Green/yellowish	Dense vegetation
Magenta/bluish	Bare soil, sparse pasture, open areas
Dark	Water or smooth surfaces
Bright, isolated white	Metallic structures and buildings
Limitations
Sentinel-2 has 10 m resolution: good for right-of-way context, not for detailing a single structure.
Radar responds to moisture, especially VV. That is why the baseline uses the same period last year and vegetation is better read in VH.
Compare ΔVH only between scenes of the same orbit and pass (the script does this).
The -3 dB threshold is a starting point. Validate in the field or with high-resolution imagery before treating it as vegetation removal.
Very recent scenes may not have Cloud Score+ yet. They appear with limpeza_no_ponto = -1: check them visually.
Next steps
Build machine learning algorithms to automate monitoring and flag anomalies along the right-of-way.
Process multiple points or the full alignment at once.
Author

Anibal Jorge de Lana, Environmental Engineer. LinkedIn: [anibal](https://www.linkedin.com/in/aniballana/)

License

MIT
