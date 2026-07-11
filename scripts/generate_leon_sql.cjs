const fs = require('fs');
const jsonRoads = require('../src/data/leonRoadInventory.json');

// Build barangay lookup from JSON
const roadToBarangay = new Map();
for (const r of jsonRoads) {
  const key = r.roadName.toLowerCase().replace(/\s+/g, ' ').trim();
  roadToBarangay.set(key, r.barangay);
}

// CSV data
const csvContent = `Road Name,Classification,Year Constructed,ROW,Total Length Km,Concrete_L,Concrete_%,Concrete_C,Asphalt_L,Asphalt_%,Asphalt_C,Gravel_L,Gravel_%,Gravel_C,Earth_L,Earth_%,Earth_C
1. Agboy Norte-Siol Norte Rd,Barangay Rd,2013,6.00,1.47,0.03,2,Fair,,,,,,,1.44,98,Poor
2. Agta Road,Barangay Rd,1983,6.00,0.85,0.41,48,Fair,,,,0.45,52,Fair,,,
3. Anonang-Sitio Bangalad,Barangay Rd,2013,6.00,0.62,0.05,8,Fair,,,,0.41,66,Fair,0.16,26,Poor
4. Apian Road,Barangay Rd,1984,6.00,0.96,0.77,80,Fair,,,,0.19,20,Fair,,,
5. Apian-Coyugan Norte Rd,Barangay Rd,1998,6.00,0.78,0.08,10,Fair,,,,0.70,90,Fair,,,
6. Avanzada-Baje Road,Barangay Rd,1983,6.00,9.36,6.76,72,Fair,,,,2.60,28,Poor,,,
7. Awis Road,Barangay Rd,1997,6.00,0.18,0.01,8,Fair,,,,0.17,92,Fair,,,
8. Ayabang Road,Barangay Rd,2000,6.00,0.74,,,,,,,0.74,100,Poor,,,
9. Ayubo Road,Barangay Rd,2022,6.00,0.13,0.13,100,Fair,,,,,,,,,
10. Bacolod Road,Barangay Rd,1999,6.00,1.05,1.05,100,Fair,,,,,,,,,
11. Bacolod-Cabunga-an Rd.,Barangay Rd,2022,6.00,1.26,1.26,100,Fair,,,,,,,,,
12. Banagan Road,Barangay Rd,1999,6.00,1.27,0.98,78,Fair,,,,0.28,22,Poor,,,
13. Barangbang Road,Barangay Rd,1983,6.00,1.55,0.88,57,Fair,,,,,,,0.66,43,Poor
14. Barasan Road,Barangay Rd,1983,6.00,0.55,0.55,100,Fair,,,,,,,,,
15. Bayag Norte-Sitio Danao Rd,Barangay Rd,2015,6.00,0.36,,,,,,,,,,0.36,100,Poor
16. Bayag Norte-Sitio Raug Rd,Barangay Rd,2015,6.00,0.53,,,,,,,,,,0.53,100,Poor
17. Binolbog Road,Barangay Rd,2000,6.00,0.69,0.21,31,Poor,,,,0.48,69,Poor,,,
18. Binolbog Road (new),Barangay Rd,2020,6.00,0.48,,,,,,,0.48,100,Fair,,,
19. Binolbog-Ambulong Road,Barangay Rd,2015,6.00,2.28,,,,,,,,,,2.28,100,Poor
20. Biri Norte-Isian Norte Road,Barangay Rd,2000,6.00,2.65,0.58,22,Fair,,,,2.07,78,Poor,,,
21. Biri Norte-Tina-an Sur Road,Barangay Rd,2000,6.00,2.73,,,,,,,2.73,100,Poor,,,
22. Biri Sur Road,Barangay Rd,2010,6.00,0.78,0.45,58,Fair,,,,,,,0.33,42,Poor
23. Biri Sur-Sitio Dulaca Road,Barangay Rd,2019,6.00,1.21,,,,,,,,,,1.21,100,Poor
24. Bucari Road,Barangay Rd,1983,6.00,0.99,0.99,100,Fair,,,,,,,,,
25. Bucari Road,Barangay Rd,1983,6.00,0.09,0.09,100,Poor,,,,,,,,,
26. Bucari-Cagay-Ingay Road,Barangay Rd,2000,10.00,4.54,1.10,24,Poor,,,,1.91,42,Fair,1.53,34,Poor
27. Bucari-Camandag Road,Barangay Rd,1998,10.00,3.02,3.02,100,Fair,,,,,,,,,
28. Bucari-Cumpan-Sibucao,Barangay Rd,2000,6.00,2.11,,,,,,,,,,2.11,100,Critical
29. Bucari-Tabionan Road,Barangay Rd,2000,6.00,0.44,,,,,,,0.44,100,Fair,,,
30. Buga Road,Barangay Rd,1960,10.00,1.50,1.50,100,Fair,,,,,,,,,
31. Buga-Sitio Dao-Baong Rd.,Barangay Rd,2014,6.00,2.46,,,,,,,0.39,16,Fair,2.08,84,Fair
32. Buga-Kananghan-Iguaras,Barangay Rd,2009,4.00,3.82,0.14,4,Fair,,,,3.24,85,Poor,0.44,11,Poor
33. Buga-Jct-Kananghan Rd,Barangay Road,2009,4.00,0.29,,,,,,,0.29,100,Poor,,,
34. Buga-Jct-Lampigaw-Pinon-an Road,Barangay Road,2010,4.00,2.97,,,,,,,0.91,31,Poor,2.06,69,Poor
35. Buga-Sitio Bugtong Road,Barangay Road,2005,4.00,0.13,0.13,100,Fair,,,,,,,,,
36. Buga-Sitio Tibod-Lanag Rd,Barangay Road,2009,6.00,1.90,,,,,,,,,,1.90,100,Poor
37. Bulad Road,Barangay Road,1997,6.00,0.87,0.80,92,Fair,,,,0.07,8,Fair,,,
38. Cabunga-an-Caboloan Rd,Barangay Road,2001,10.00,1.87,1.87,100,Fair,,,,,,,,,
39. Cabutongan Road,Barangay Road,1984,6.00,0.71,0.71,100,Fair,,,,,,,,,
40. Cagay Road,Barangay Road,2000,6.00,0.30,,,,,,,,,,0.30,100,Poor
41. Camandag-Bobon Road,Barangay Road,1999,10.00,1.75,1.75,100,Fair,,,,,,,,,
42. Camandag-Bulwang Rd,Barangay Road,1998,6.00,0.80,0.80,100,Fair,,,,,,,,,
43. Cananaman Road,Barangay Road,1984,6.00,2.05,2.05,100,Fair,,,,,,,,,
44. Capt. Fernando-Paoy Rd,Barangay Road,1997,6.00,0.75,,,,,,,0.75,100,Fair,,,
45. Capt. Fernando-Sitio Limotan Road,Barangay Road,2022,6.00,0.68,,,,,,,,,,0.68,100,Poor
46. Capt. Fernando-Lang-og Rd.,Barangay Road,2022,6.00,0.51,,,,,,,,,,0.51,100,Poor
47. Carara-an-Sitio Talibong Rd,Barangay Road,2022,6.00,1.94,1.94,100,Fair,,,,,,,,,
48. Carolina Road,Barangay Road,1998,6.00,0.80,0.80,100,Fair,,,,,,,,,
49. Carolina Rd. Jct Langog Rd,Barangay Road,1992,6.00,0.83,0.43,51,Fair,,,,,,,0.40,49,Poor
50. Coyugan Norte Road,Barangay Road,1998,6.00,0.53,0.23,43,Fair,,,,0.30,57,Poor,,,
51. Coyugan Sur Road,Barangay Road,1983,6.00,0.76,0.76,100,Fair,,,,,,,,,
52. Coyugan Sur Road New,Barangay Road,2022,6.00,0.39,0.39,100,Fair,,,,,,,,,
53. Danao Road,Barangay Road,2022,6.00,1.50,,,,,,,,,,1.50,100,Poor
54. Dorog Road,Barangay Road,1983,6.00,0.63,0.63,100,Fair,,,,,,,,,
55. Dorog-Marirong Road,Barangay Road,2017,6.00,3.02,2.94,97,Fair,,,,,,,0.08,3,Poor
56. Dorog-Carara-an Road,Barangay Road,1998,6.00,1.92,1.22,64,Fair,,,,0.70,36,Fair,,,
57. Dorog-Cawilihan Road,Barangay Road,2009,6.00,2.62,0.13,5,Fair,,,,2.49,95,Fair,,,
58. Dusacan Road (new),Barangay Road,2022,6.00,0.27,,,,,,,0.27,100,Poor,,,
59. Gines Brgy. Proper New Rd,Barangay Road,2021,6.00,0.39,0.39,100,Fair,,,,,,,,,
60. Gines-Ayabang Road,Barangay Road,2001,6.00,0.75,0.64,84,Fair,,,,,,,0.12,16,Poor
61. Gines-Ticuan Road,Barangay Road,2001,6.00,0.91,0.91,100,Fair,,,,,,,,,
62. Gines-Tunguan Road,Barangay Road,2001,6.00,2.10,1.34,64,Fair,,,,0.76,36,Fair,,,
63. Gines-Sitio Mayang,Barangay Road,2022,10.00,0.49,0.49,100,Fair,,,,,,,,,
64. Gumboc-Awis-Paoy-Camando Road,Barangay Road,1984,6.00,5.11,1.10,22,Fair,,,,4.01,78,Fair,,,
65. Gumboc-Jct Capt. Fernando Road,Barangay Road,1984,6.00,0.99,0.54,54,Fair,,,,0.45,46,Fair,,,
66. Gumboc-Sitio Biasong,Barangay Road,2022,6.00,0.57,,,,,,,0.57,100,Fair,,,
67. Gumboc-Sitio Taal,Barangay Road,2022,6.00,0.43,,,,,,,0.43,100,Fair,,,
68. Igcadios Road,Barangay Road,1983,6.00,0.85,0.33,39,Fair,,,,0.52,61,Fair,,,
69. Igcadios-Ayabang Road,Barangay Road,2009,6.00,1.18,,,,,,,,,,1.18,100,Poor
70. Igcadios-Carara-an Road,Barangay Road,2022,6.00,0.96,,,,,,,,,,0.96,100,Poor
71. Isian Norte-Casling Road,Barangay Road,1999,6.00,1.67,0.81,48,Fair,,,,0.86,52,Fair,,,
72. Isian Norte-Sitio Gaspangan,Barangay Road,2019,6.00,0.27,,,,,,,,,,0.27,100,Fair
73. Isian Norte-Sitio Lanag,Barangay Road,1999,6.00,0.58,0.58,100,Fair,,,,,,,,,
74. Isian Norte-Sitio Lanag-Isian Victoria Road,Barangay Road,2022,6.00,0.77,,,,,,,,,,0.77,100,Poor
75. Isian Victoria Road,Barangay Road,2002,6.00,2.89,0.49,17,Fair,,,,,,,2.39,83,Poor
76. Jamog Gines Road,Barangay Road,2005,6.00,0.14,0.14,100,Fair,,,,,,,,,
77. Jamog Gines Road,Barangay Road,2017,6.00,0.30,0.15,50,Fair,,,,0.15,50,Good,,,
78. Lanag-ISAT U Demo Farm Rd,Barangay Road,2021,6.00,1.19,,,,,,,,,,1.19,100,Poor
79. Lang-og Road,Barangay Road,1982,6.00,0.98,0.98,100,Fair,,,,,,,,,
80. Lanag Road,Barangay Road,1982,6.00,1.18,0.97,82,Fair,,,,0.21,18,Poor,,,
81. Lanag-Nagbangi-Tuog,Barangay Road,1999,6.00,3.56,1.50,42,Fair,,,,2.06,58,Fair,,,
82. Lanag (going to Don Felimon Inland Resort,Barangay Road,2021,6.00,1.25,,,,,,,1.25,100,Poor,,,
83. Lanag-Sitio Puro Gamay,Barangay Road,2001,6.00,0.51,,,,,,,0.51,100,Fair,,,
84. Lanag-Tu-og Road,Barangay Road,2022,6.00,0.93,,,,,,,0.18,19,Fair,0.75,81,Poor
85. Ligtos Road,Barangay Road,1984,6.00,0.47,0.43,91,Fair,,,,0.04,9,Fair,,,
86. Ligtos-Gines Road,Barangay Road,1984,10.00,5.49,2.35,43,Fair,,,,3.14,57,Fair,,,
87. Magcapay-Sitio Kalapadan Road,Barangay Road,2018,6.00,0.55,,,,,,,,,,0.55,100,Poor
88. Magcapay-Sitio Bungad Rd,Barangay Road,2022,6.00,0.48,,,,,,,,,,0.48,100,Poor
89. Magcapay Road,Barangay Road,2009,6.00,1.75,1.09,63,Fair,,,,0.65,37,Poor,,,
90. Maliao Road,Barangay Road,1999,6.00,0.28,,,,,,,0.28,100,Fair,,,
91. Maliao-Cabunga-an Rd,Barangay Road,1997,6.00,2.65,0.56,21,Fair,,,,2.09,79,Poor,,,
92. Maliao-Lampaya Road,Barangay Road,2001,6.00,1.76,0.39,22,Fair,,,,1.37,78,Poor,,,
93. Malublub Road,Barangay Road,1998,6.00,1.87,1.29,69,Fair,,,,0.59,31,Fair,,,
94. Malublub-Abang-Abang Rd,Barangay Road,2009,6.00,2.24,,,,,,,,,,2.24,100,Poor
95. Malublub-Sitio Lintian Rd,Barangay Road,2017,6.00,2.00,,,,,,,2.00,100,Fair,,,
96. Malublub-Sitio Buyo,Barangay Road,2018,6.00,0.89,,,,,,,,,,0.89,100,Poor
97. Malublub-Sitio Tumotob,Barangay Road,2018,6.00,1.82,,,,,,,,,,1.82,100,Poor
98. Manampunay-Tac. Norte Rd,Barangay Road,1999,10.00,2.10,1.23,58,Fair,,,,0.87,42,Fair,,,
99. Marirong Road,Barangay Road,2018,6.00,0.29,0.29,100,Fair,,,,,,,,,
100. Mina Road,Barangay Road,2005,6.00,0.84,0.29,35,Fair,,,,0.55,65,Fair,,,
101. Mocol Road,Barangay Road,1983,6.00,0.45,0.45,100,Fair,,,,,,,,,
102. Nagbangi Road,Barangay Road,1983,6.00,0.32,,,,,,,0.32,100,Fair,,,
103. Nagbangi-Siol Norte-Agboy Sur Road,Barangay Road,1999,6.00,3.80,1.36,36,Fair,,,,2.45,64,Fair,,,
104. Nalbang Road,Barangay Road,1983,6.00,0.43,0.43,100,Fair,,,,,,,,,
105. Odong-Odong Road,Barangay Road,1983,6.00,1.01,0.52,51,Fair,,,,0.50,49,Fair,,,
106. Oluangan Road,Barangay Road,1983,6.00,2.11,0.92,44,Fair,,,,1.19,56,Fair,,,
107. Paga Road,Barangay Road,2022,6.00,1.51,1.51,100,Fair,,,,,,,,,
108. Pandan-Buenavista Rd.,Barangay Road,1983,6.00,1.57,1.57,100,Fair,,,,,,,,,
109. Pandan-Barawbaraw Rd,Barangay Road,2022,6.00,0.87,,,,,,,0.87,100,Fair,,,
110. Pandan-Composting Center Road,Barangay Road,1994,6.00,0.45,,,,,,,0.45,100,Fair,,,
111. Paoy Road,Barangay Road,1997,6.00,0.60,0.11,18,Fair,,,,,,,0.49,82,Poor
112. Pepe-Binolbog Road,Barangay Road,1983,6.00,1.16,0.04,3,Poor,,,,0.04,3,Poor,1.09,93,Poor
113. Poblacion-Sitio Buntalan Sitio Dugo Road,Barangay Road,2018,10.00,0.44,0.44,100,Fair,,,,,,,,,
114. Poblacion-Sitio Dugo Rd,Barangay Road,2005,10.00,1.03,0.40,38,Fair,,,,0.64,62,Fair,,,
115. Poblacion-Sitio Miac-ac,Barangay Road,2005,6.00,1.77,1.08,61,Fair,,,,0.70,39,Fair,,,
116. Salngan Road,Barangay Road,1986,6.00,1.12,0.46,41,Fair,,,,0.66,59,Fair,,,
117. Salngan-Isian Victoria Rd,Barangay Road,1986,6.00,1.01,0.87,86,Fair,,,,0.14,14,Fair,,,
118. Samlague Road,Barangay Road,2010,6.00,1.00,0.86,86,Fair,,,,0.14,14,Fair,,,
119. Siol Sur Road,Barangay Road,2005,6.00,0.36,0.36,100,Fair,,,,,,,,,
120. Siol Sur-Anonang Road,Barangay Road,2016,6.00,1.24,,,,,,,1.24,100,Fair,,,
121. Tacuyong Norte Road,Barangay Road,1999,6.00,0.57,0.57,100,Fair,,,,,,,,,
122. Tac. Norte-Marirong Rd.,Barangay Road,1986,6.00,0.82,0.82,100,Fair,,,,,,,,,
123. Tacuyong Sur Road,Barangay Road,1982,6.00,0.59,0.59,100,Fair,,,,,,,,,
124. Tac. Sur-Baje Road,Barangay Road,2003,6.00,2.24,1.92,86,Fair,,,,0.32,14,Fair,,,
125. Tagsing Road,Barangay Road,1983,6.00,1.76,0.60,34,Fair,,,,1.16,66,Fair,,,
126. Talacu-an-Takasi-Panginman Road,Barangay Road,2009,6.00,0.81,0.51,63,Fair,,,,0.30,37,Poor,,,
127. Takasi-Bunga Road,Barangay Road,2021,6.00,0.39,,,,,,,0.39,100,Fair,,,
128. Tina-an Norte Road,Barangay Road,1961,6.00,0.73,0.73,100,Fair,,,,,,,,,
129. Tina-an Norte-Sitio Bugo,Barangay Road,2022,4.00,0.47,0.14,30,Fair,,,,0.33,70,Poor,,,
130. Tunguan-Lampaya Road,Barangay Road,2017,6.00,1.50,,,,,,,,,,1.50,100,Poor
131. Tunguan-Banagan Road,Barangay Road,2005,6.00,1.51,,,,,,,,,,1.51,100,Poor
132. Tu-og Road,Barangay Road,2022,6.00,0.41,0.07,17,Fair,,,,0.34,83,Fair,0,0,Poor
133. Tu-og-Lanot Road,Barangay Road,2000,6.00,0.55,0.19,35,Fair,,,,0.36,65,Fair,,,
134. Tu-og-Siol Norte Road,Barangay Road,2022,6.00,1.44,,,Fair,,,,,,,1.44,100,Poor
135. Dorog-Marirong-Dorog,Barangay Road,2022,6.00,0.90,0.90,100,Good,,,,,,,,,
136. Cemetery Road.,Barangay Road,2022,6.00,0.90,0.90,100,Good,,,,,,,,,`;

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function cleanRoadName(name) {
  return name.replace(/^\d+[\.\s]+/, '').trim();
}

function n(v) {
  const s = String(v).trim();
  if (s === '' || s === null || s === undefined) return 'NULL';
  const num = parseFloat(s);
  return isNaN(num) ? 'NULL' : num;
}

function q(v) {
  const s = String(v).trim();
  if (s === '' || s === null || s === undefined) return 'NULL';
  return "'" + s.replace(/'/g, "''") + "'";
}

function findBarangay(roadName) {
  const key = roadName.toLowerCase().replace(/\s+/g, ' ').trim();
  if (roadToBarangay.has(key)) return roadToBarangay.get(key);
  for (const [k, v] of roadToBarangay) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  const parts = roadName.split(/[-–—,]/);
  if (parts.length > 0) {
    const first = parts[0].trim().toLowerCase();
    for (const [k, v] of roadToBarangay) {
      if (k.startsWith(first) || first.startsWith(k)) return v;
    }
  }
  return 'NULL';
}

const lines = csvContent.trim().split('\n');
const roads = [];

for (let i = 1; i < lines.length; i++) {
  const f = parseCsvLine(lines[i]);
  if (f.length < 5) continue;
  const roadName = cleanRoadName(f[0] || '');
  if (!roadName) continue;

  const barangay = findBarangay(roadName);

  roads.push({
    name: roadName,
    barangay: barangay,
    class: f[1] || '',
    year: n(f[2]),
    row: n(f[3]),
    length: n(f[4]),
    conL: n(f[5]), conPct: n(f[6]), conC: q(f[7]),
    aspL: n(f[8]), aspPct: n(f[9]), aspC: q(f[10]),
    grvL: n(f[11]), grvPct: n(f[12]), grvC: q(f[13]),
    ethL: n(f[14]), ethPct: n(f[15]), ethC: q(f[16])
  });
}

// Build SQL using array join to avoid escaping issues
const lines_out = [];

lines_out.push('-- ============================================================');
lines_out.push('-- KalsaTrack - LGU Leon Barangay Roads Inventory (' + roads.length + ' roads)');
lines_out.push('-- Generated from Leon_barangay_roads.csv with barangay mapping');
lines_out.push('-- Run this in Supabase SQL Editor');
lines_out.push('-- ============================================================');
lines_out.push('');

lines_out.push('CREATE TABLE IF NOT EXISTS public.lgu_road_inventory (');
lines_out.push('  id                    BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,');
lines_out.push('  road_name             TEXT NOT NULL,');
lines_out.push('  barangay              TEXT DEFAULT \'\',');
lines_out.push('  municipality          TEXT DEFAULT \'Leon\',');
lines_out.push('  province              TEXT DEFAULT \'Iloilo\',');
lines_out.push('  classification        TEXT DEFAULT \'\',');
lines_out.push('  length_km             DOUBLE PRECISION DEFAULT 0,');
lines_out.push('  right_of_way_m        DOUBLE PRECISION DEFAULT 0,');
lines_out.push('  year_constructed      INTEGER,');
lines_out.push('  concrete_km           DOUBLE PRECISION,');
lines_out.push('  concrete_pct          DOUBLE PRECISION,');
lines_out.push('  concrete_condition    TEXT,');
lines_out.push('  asphalt_km            DOUBLE PRECISION,');
lines_out.push('  asphalt_pct           DOUBLE PRECISION,');
lines_out.push('  asphalt_condition     TEXT,');
lines_out.push('  gravel_km             DOUBLE PRECISION,');
lines_out.push('  gravel_pct            DOUBLE PRECISION,');
lines_out.push('  gravel_condition      TEXT,');
lines_out.push('  earth_km              DOUBLE PRECISION,');
lines_out.push('  earth_pct             DOUBLE PRECISION,');
lines_out.push('  earth_condition       TEXT,');
lines_out.push('  source                TEXT DEFAULT \'LGU Leon Barangay Roads CSV\',');
lines_out.push('  created_at            TIMESTAMPTZ DEFAULT now(),');
lines_out.push('  updated_at            TIMESTAMPTZ DEFAULT now()');
lines_out.push(');');
lines_out.push('');

lines_out.push('ALTER TABLE public.lgu_road_inventory ENABLE ROW LEVEL SECURITY;');
lines_out.push('');

lines_out.push('CREATE POLICY IF NOT EXISTS "auth_sel_lgu_road_inventory"');
lines_out.push('  ON public.lgu_road_inventory FOR SELECT TO authenticated USING (true);');
lines_out.push('CREATE POLICY IF NOT EXISTS "anon_sel_lgu_road_inventory"');
lines_out.push('  ON public.lgu_road_inventory FOR SELECT TO anon USING (true);');
lines_out.push('CREATE POLICY IF NOT EXISTS "auth_ins_lgu_road_inventory"');
lines_out.push('  ON public.lgu_road_inventory FOR INSERT TO authenticated WITH CHECK (true);');
lines_out.push('CREATE POLICY IF NOT EXISTS "auth_upd_lgu_road_inventory"');
lines_out.push('  ON public.lgu_road_inventory FOR UPDATE TO authenticated USING (true);');
lines_out.push('CREATE POLICY IF NOT EXISTS "auth_del_lgu_road_inventory"');
lines_out.push('  ON public.lgu_road_inventory FOR DELETE TO authenticated USING (true);');
lines_out.push('');

lines_out.push('DO $$');
lines_out.push('BEGIN');
lines_out.push('  IF NOT EXISTS (');
lines_out.push('    SELECT 1 FROM pg_publication_tables');
lines_out.push('    WHERE pubname = \'supabase_realtime\' AND tablename = \'lgu_road_inventory\'');
lines_out.push('  ) THEN');
lines_out.push('    ALTER PUBLICATION supabase_realtime ADD TABLE public.lgu_road_inventory;');
lines_out.push('  END IF;');
lines_out.push('END $$;');
lines_out.push('');

lines_out.push('INSERT INTO public.lgu_road_inventory (');
lines_out.push('  road_name, barangay, municipality, classification, length_km,');
lines_out.push('  right_of_way_m, year_constructed,');
lines_out.push('  concrete_km, concrete_pct, concrete_condition,');
lines_out.push('  asphalt_km, asphalt_pct, asphalt_condition,');
lines_out.push('  gravel_km, gravel_pct, gravel_condition,');
lines_out.push('  earth_km, earth_pct, earth_condition');
lines_out.push(') VALUES');

for (let j = 0; j < roads.length; j++) {
  const r = roads[j];
  const comma = (j < roads.length - 1) ? ',' : ';';
  const line = '  (' + q(r.name) + ', ' + q(r.barangay) + ", 'Leon', 'Iloilo', " + q(r.class) + ', ' + r.length + ', ' + r.row + ', ' + r.year + ', ' + r.conL + ', ' + r.conPct + ', ' + r.conC + ', ' + r.aspL + ', ' + r.aspPct + ', ' + r.aspC + ', ' + r.grvL + ', ' + r.grvPct + ', ' + r.grvC + ', ' + r.ethL + ', ' + r.ethPct + ', ' + r.ethC + ')' + comma;
  lines_out.push(line);
}

lines_out.push('');

let totalKm = 0;
let matched = 0;
for (const r of roads) {
  if (typeof r.length === 'number') totalKm += r.length;
  if (r.barangay !== 'NULL') matched++;
}

lines_out.push('-- ============================================================');
lines_out.push('-- Done! ' + roads.length + ' roads, ' + totalKm.toFixed(2) + ' km total');
lines_out.push('-- Barangays matched: ' + matched + '/' + roads.length);
lines_out.push('-- ============================================================');

fs.writeFileSync('supabase_leon_road_inventory.sql', lines_out.join('\n'), 'utf8');
console.log('Generated supabase_leon_road_inventory.sql with ' + roads.length + ' roads, ' + totalKm.toFixed(2) + ' km');
console.log('Barangays matched: ' + matched + '/' + roads.length);