-- ============================================================
-- Supabase Migration: Completed FMR Projects (2014–2023)
-- Department of Agriculture - RAED Region VI
-- Farm-to-Market Road Development Program (FMRDP)
-- 
-- Run this AFTER supabase_fmr_projects_migration.sql
-- These are the historical completed projects from the CSV data
-- ============================================================

-- Insert completed projects from 2014-2023 into the existing fmr_projects table
INSERT INTO public.fmr_projects (year_funded, project_name, location, municipality, status, date_completed, project_length_km, start_latitude, start_longitude, end_latitude, end_longitude, accomplishment) VALUES
-- 2014 Funded
(2014, 'Concreting of Bucaya-Cadoidolan-Mayunoc-Matambog FMR', 'Bucaya-Cadoidolan-Mayunoc-Matambog', 'Iloilo', 'Completed', 'October 31, 2015', 0.44, 10.587527, 122.111274, 10.590221, 122.109430, 100),
(2014, 'Concreting of Cabanbanan-Sambaludan FMR', 'Cabanbanan-Sambaludan', 'Iloilo', 'Completed', 'January 02, 2016', 0.49, 10.682630, 122.425881, 10.686707, 122.424471, 100),
(2014, 'Concreting of Camangahan-Bacong FMR', 'Camangahan-Bacong', 'Iloilo', 'Completed', 'September 10, 2015', 0.46, 10.710082, 122.310750, 10.707200, 122.304088, 100),
(2014, 'Concreting of Jovellar-Paong-Nito-an FMR', 'Jovellar-Paong-Nito-an', 'Iloilo', 'Completed', 'October 12, 2015', 0.30, 10.699734, 122.285859, 10.698786, 122.283083, 100),
(2014, 'Concreting of Brgy. 5-Mulangan FMR', 'Brgy. 5-Mulangan', 'Iloilo', 'Completed', 'August 30, 2015', 0.13, 10.723644, 122.255119, 10.724388, 122.254270, 100),
(2014, 'Concreting of Igcocolo-Nabangko FMR', 'Igcocolo-Nabangko', 'Iloilo', 'Completed', 'July 30, 2015', 0.15, 10.682752, 122.323940, 10.682927, 122.325228, 100),
(2014, 'Concreting of Sta. Rosa-Laguna-Marocco-Particion FMR', 'Sta. Rosa-Laguna-Marocco-Particion', 'Guimbal', 'Completed', 'September 24, 2015', 0.65, 10.671942, 122.310316, 10.672883, 122.315724, 100),
(2014, 'Concreting of Igcocolo-Sipitan FMR', 'Igcocolo-Sipitan', 'Guimbal', 'Completed', 'July 30, 2015', 0.62, 10.682197, 122.319523, 10.680017, 122.318048, 100),
(2014, 'Concreting of Brgy. Bucari FMR', 'Brgy. Bucari', 'Leon', 'Completed', 'August 14, 2015', 0.24, 10.869424, 122.298061, 10.868785, 122.296608, 100),
(2014, 'Concreting of Brgy. Calaboa FMR', 'Brgy. Calaboa', 'Iloilo', 'Completed', 'June 15, 2015', 0.25, 10.811269, 122.582991, 10.809229, 122.582119, 100),

-- 2015 Funded
(2015, 'Concreting of Brgy. Balantad to Brgy. Moncillas FMR, Guimbal, Iloilo', 'Brgy. Balantad and Brgy. Moncillas, Guimbal, Iloilo', 'Guimbal', 'Completed', 'September 17, 2015', 0.19, 10.666903, 122.321056, 10.668057, 122.319158, 100),
(2015, 'Concreting of Brgy. Cabubugan to Brgy. Baras FMR, Guimbal, Iloilo', 'Brgy. Cabubugan and Brgy. Baras, Guimbal, Iloilo', 'Guimbal', 'Completed', 'September 17, 2015', 0.10, 10.658924, 122.292447, 10.660432, 122.293904, 100),
(2015, 'Concreting of Brgy. Igbugo to Brgy. Cawayanan FMR, Miag-ao, Iloilo', 'Brgy. Igbugo and Brgy. Cawayanan, Miag-ao, Iloilo', 'Miag-ao', 'Completed', 'August 23, 2015', 0.41, 10.653912, 122.167073, 10.655561, 122.166972, 100),
(2015, 'Concreting of Brgy. Magsaysay to Brgy. Balantad to Brgy. Rizal to Brgy. Baling FMR, Guimbal, Iloilo', 'Brgy. Magsaysay, Brgy. Balantad, Brgy. Rizal and Brgy. Baling, Guimbal, Iloilo', 'Guimbal', 'Completed', 'March 01, 2016', 0.18, 10.668366, 122.323185, 10.667003, 122.324390, 100),
(2015, 'Concreting of Brgy. Poblacion to Brgy. Huna Bayuyan FMR, San Joaquin, Iloilo', 'Brgy. Poblacion and Brgy. Huna Bayuyan, San Joaquin, Iloilo', 'San Joaquin', 'Completed', 'October 22, 2015', 0.50, 10.604959, 122.143269, 10.607376, 122.143647, 100),
(2015, 'Concreting of Brgy. San Ambrosio to Brgy. Pasong Road FMR, Igbaras, Iloilo', 'Brgy. San Ambrosio and Brgy. Pasong, Igbaras, Iloilo', 'Igbaras', 'Completed', 'October 21, 2015', 0.37, 10.719402, 122.234725, 10.720483, 122.237659, 100),
(2015, 'Concreting of Brgy. San Joaquin to Brgy. Huna FMR, San Joaquin, Iloilo', 'Brgy. San Joaquin and Brgy. Huna, San Joaquin, Iloilo', 'San Joaquin', 'Completed', 'October 08, 2015', 0.34, 10.607302, 122.143646, 10.600997, 122.140794, 100),
(2015, 'Concreting of Brgy. Sta. Rosa-Laguna to Brgy. Bankiling to Brgy. Anono-o Road FMR, Guimbal, Iloilo', 'Brgy. Sta. Rosa-Laguna, Brgy. Bankiling and Brgy. Anono-o, Guimbal, Iloilo', 'Guimbal', 'Completed', 'September 19, 2015', 0.37, 10.754871, 122.343376, 10.663971, 122.305853, 100),
(2015, 'Concreting of Brgy. Teniente Benito to Brgy. Ago FMR, Tubungan, Iloilo', 'Brgy. Teniente Benito and Brgy. Ago, Tubungan, Iloilo', 'Tubungan', 'Completed', 'October 08, 2015', 0.60, 10.773840, 122.315411, 10.778629, 122.317327, 100),
(2015, 'Concreting of Brgy. Amparo to Brgy. Sta. Barbara Boundary Road FMR, Pavia, Iloilo', 'Brgy. Amparo and Brgy. Sta. Barbara, Pavia, Iloilo', 'Pavia', 'Completed', 'March 05, 2016', 0.20, 10.775725, 122.521205, 10.777638, 122.517521, 100),

-- 2016 Funded
(2016, 'Concreting of Mayang-Jolason-Ayubo FMR', 'Mayang-Jolason-Ayubo, Tubungan, Iloilo', 'Tubungan', 'Completed', 'November 25, 2016', 0.30, 10.774191, 122.322808, 10.772388, 122.321233, 100),
(2016, 'Concreting of Pitogo-Cubay FMR', 'Pitogo-Cubay, San Joaquin, Iloilo', 'San Joaquin', 'Completed', 'December 15, 2016', 0.50, 10.589811, 122.055258, 10.590004, 122.053235, 100),
(2016, 'Concreting of Igcocolo-Paradahan FMR', 'Igcocolo-Paradahan, Guimbal, Iloilo', 'Guimbal', 'Completed', 'March 29, 2016', 0.20, 10.689357, 122.318028, 10.691728, 122.315640, 100),
(2016, 'Concreting of Singon FMR', 'Singon, Tubungan, Iloilo', 'Tubungan', 'Completed', 'November 25, 2016', 0.30, 10.785034, 122.304247, 10.785304, 122.302542, 100),
(2016, 'Concreting of Brgy. Amparo FMR (Sitio Bong-ao)', 'Brgy. Amparo (Sitio Bong-ao), Pavia, Iloilo', 'Pavia', 'Completed', 'December 28, 2016', 0.50, 10.786480, 122.528206, 10.789411, 122.525593, 100),
(2016, 'Concreting of Brgy. Balud 1 FMR', 'Brgy. Balud 1, Dumangas, Iloilo', 'Dumangas', 'Completed', 'October 21, 2016', 0.20, 10.843525, 122.648883, 10.842333, 122.651764, 100),
(2016, 'Concreting of Brgy. Balud Lilo-an FMR', 'Brgy. Balud Lilo-an, Dumangas, Iloilo', 'Dumangas', 'Completed', 'October 21, 2016', 0.20, 10.815213, 122.638851, 10.817447, 122.639853, 100),
(2016, 'Concreting of Brgy. Bita-og Gaja FMR', 'Brgy. Bita-og Gaja, New Lucena, Iloilo', 'New Lucena', 'Completed', 'October 21, 2016', 0.20, 10.842504, 122.575868, 10.844799, 122.574551, 100),
(2016, 'Concreting of Brgy. 16 FMR', 'Brgy. 16, Iloilo City', 'Iloilo City', 'Completed', 'October 21, 2016', 0.20, 10.772154, 122.457580, 10.771755, 122.340107, 100),
(2016, 'Concreting of Cabilauan-Wari Wari FMR', 'Cabilauan-Wari Wari, New Lucena, Iloilo', 'New Lucena', 'Completed', 'October 21, 2016', 0.20, 10.881783, 122.569042, 10.879709, 122.569093, 100),

-- 2017 Funded
(2017, 'Concreting of Hamungaya, Brgy. Jaro FMR, Iloilo City, Iloilo', 'Hamungaya, Brgy. Jaro, Iloilo City, Iloilo', 'Iloilo City', 'Completed', 'September 16, 2017', 1.03, 10.773969, 122.570054, 10.773333, 122.573545, 100),
(2017, 'Concreting of Brgy. Zone 5 Buntatala FMR, Iloilo City, Iloilo', 'Brgy. Zone 5 Buntatala, Iloilo City, Iloilo', 'Iloilo City', 'Completed', 'December 15, 2017', 0.50, 10.764588, 122.584773, 10.762796, 122.585570, 100),
(2017, 'Construction/Opening of Brgy. Bobon, Leon to Brgy. Manasa, Alimodian FMR', 'Brgy. Bobon, Leon and Brgy. Manasa, Alimodian, Iloilo', 'Leon', 'Completed', 'January 10, 2017', 0.83, 10.895245, 122.297452, 10.898085, 122.307425, 100),
(2017, 'Concreting of Brgy. Bulay FMR, Cabatuan, Iloilo', 'Brgy. Bulay, Cabatuan, Iloilo', 'Cabatuan', 'Completed', 'September 9, 2017', 0.46, 10.925258, 122.480132, 10.923758, 122.484029, 100),
(2017, 'Concreting of Brgy. Canawili FMR, Janiuay, Iloilo', 'Brgy. Canawili, Janiuay, Iloilo', 'Janiuay', 'Completed', 'October 9, 2017', 1.10, 11.015595, 122.427955, 11.020724, 122.422028, 100),
(2017, 'Concreting of Brgy. Casalsagan to Brgy. Jamabalud Road FMR, Pototan, Iloilo', 'Brgy. Casalsagan and Brgy. Jamabalud, Pototan, Iloilo', 'Pototan', 'Completed', 'September 6, 2017', 0.53, 10.893803, 122.614724, 10.891305, 122.618489, 100),
(2017, 'Concreting of Brgy. Supanga to Brgy. Caratagan FMR, Calinog, Iloilo', 'Brgy. Supanga and Brgy. Caratagan, Calinog, Iloilo', 'Calinog', 'Completed', 'December 5, 2017', 0.57, 11.149862, 122.363896, 11.155148, 122.357928, 100),
(2017, 'Concreting of Brgy. JNR Cabugao Nuevo to Brgy. Palje FMR, San Enrique, Iloilo', 'Brgy. Cabugao Nuevo and Brgy. Palje, San Enrique, Iloilo', 'San Enrique', 'Completed', 'November 15, 2017', 0.27, 11.066921, 122.669231, 11.069107, 122.670743, 100),
(2017, 'Construction of Brgy. Cansilayan to Brgy. Capaliz FMR, Dumangas, Iloilo', 'Brgy. Cansilayan and Brgy. Capaliz, Dumangas, Iloilo', 'Dumangas', 'Completed', 'August 25, 2017', 0.18, 10.845273, 122.701159, 10.846996, 122.702312, 100),
(2017, 'Concreting of Brgy. Cayos to Brgy. Makina NIA Road, Dumangas, Iloilo', 'Brgy. Cayos and Brgy. Makina, Dumangas, Iloilo', 'Dumangas', 'Completed', 'September 17, 2017', 0.55, 10.818691, 122.660047, 10.824549, 122.659756, 100),

-- 2018 Funded
(2018, 'Concreting/Rehabilitation of Brgy. Abilay Norte FMR, Oton, Iloilo', 'Brgy. Abilay Norte, Oton, Iloilo', 'Oton', 'Completed', 'December 13, 2018', 0.50, 10.743041, 122.492500, 10.739328, 122.495384, 100),
(2018, 'Concreting of Brgy. Bagacay to Brgy. Danao to Brgy. Bugasongan FMR, Tigbauan, Iloilo', 'Brgy. Bagacay, Brgy. Danao and Brgy. Bugasongan, Tigbauan, Iloilo', 'Tigbauan', 'Completed', 'March 1, 2019', 0.50, 10.696897, 122.355651, 10.700180, 122.352253, 100),
(2018, 'Concreting of Brgy. Baje San Julian - Owak FMR, Calinog, Iloilo', 'Brgy. Baje San Julian and Brgy. Owak, Calinog, Iloilo', 'Calinog', 'Completed', 'July 31, 2018', 0.83, 11.148300, 122.530214, 11.154742, 122.535685, 100),
(2018, 'Concreting/Improvement of Brgy. Cabalabaguan FMR, Mina, Iloilo', 'Brgy. Cabalabaguan, Mina, Iloilo', 'Mina', 'Completed', 'September 8, 2018', 0.52, 10.937618, 122.585404, 10.934344, 122.587909, 100),
(2018, 'Concreting of Catoogan - Igang FMR, Pototan, Iloilo', 'Brgy. Catoogan and Brgy. Igang, Pototan, Iloilo', 'Pototan', 'Completed', 'June 30, 2018', 1.16, 10.933909, 122.645199, 10.923662, 122.643494, 100),
(2018, 'Concreting of Brgy. Damires - Tamuan FMR', 'Brgy. Damires - Tamuan, Iloilo', 'Janiuay', 'Completed', 'July 16, 2018', 0.47, 10.960544, 122.516190, 10.957224, 122.517726, 100),
(2018, 'Concreting of Brgy. Ipil - Lonoy FMR', 'Brgy. Ipil - Lonoy, Iloilo', 'Calinog', 'Completed', 'July 16, 2018', 1.00, 11.128086, 122.496774, 11.130906, 122.489222, 100),
(2018, 'Concreting of Brgy. Lay-ahan - Sinuagan FMR', 'Brgy. Lay-ahan - Sinuagan, Iloilo', 'Pototan', 'Completed', 'August 30, 2018', 2.27, 10.972450, 122.601761, 10.979004, 122.581487, 100),
(2018, 'Concreting of Brgy. Pispis - Brgy. Layog FMR', 'Brgy. Pispis - Brgy. Layog, Iloilo', 'Maasin', 'Completed', 'July 30, 2018', 0.71, 10.905779, 122.446221, 10.909816, 122.449070, 100),
(2018, 'Concreting of Sitio Kapitungan, Brgy. Bolo FMR, Carles, Iloilo', 'Brgy. Bolo, Carles, Iloilo', 'Carles', 'Completed', 'October 23, 2018', 1.00, 11.515278, 123.089378, 11.513098, 123.097978, 100),

-- 2019 Funded
(2019, 'Concreting of Brgy. Nanga FMR, Guimbal, Iloilo', 'Brgy. Nanga, Guimbal, Iloilo', 'Guimbal', 'Completed', 'August 28, 2020', 0.69, 10.754871, 122.343376, 10.760431, 122.340107, 100),
(2019, 'Concreting of Brgy. Nagbangi - Brgy. Agboy Sur FMR, Leon, Iloilo', 'Brgy. Nagbangi and Brgy. Agboy Sur, Leon, Iloilo', 'Leon', 'Completed', 'March 4, 2020', 0.97, 10.784947, 122.399902, 10.780886, 122.407161, 100),
(2019, 'Concreting of Brgy. Tugas FMR, Sta. Barbara, Iloilo', 'Brgy. Tugas, Sta. Barbara, Iloilo', 'Sta. Barbara', 'Completed', 'January 19, 2020', 0.45, 10.867183, 122.527196, 10.869173, 122.531271, 100),
(2019, 'Concreting of Brgy. Daga FMR, Sta. Barbara, Iloilo', 'Brgy. Daga, Sta. Barbara, Iloilo', 'Sta. Barbara', 'Completed', 'January 19, 2020', 0.50, 10.855813, 122.562538, 10.851256, 122.562766, 100),
(2019, 'Concreting of Brgy. Bitaog Gaja FMR, New Lucena, Iloilo', 'Brgy. Bitaog Gaja, New Lucena, Iloilo', 'New Lucena', 'Completed', 'January 19, 2020', 0.51, 10.839945, 122.584292, 10.840189, 122.589572, 100),
(2019, 'Concreting of Brgy. Purog FMR, Pototan, Iloilo', 'Brgy. Purog, Pototan, Iloilo', 'Pototan', 'Completed', 'March 23, 2020', 0.88, 10.939234, 122.610870, 10.927519, 122.610897, 100),
(2019, 'Concreting of Brgy. Cahaguikican FMR, Pototan, Iloilo', 'Brgy. Cahaguikican, Pototan, Iloilo', 'Pototan', 'Completed', 'February 24, 2020', 0.89, 10.911503, 122.623537, 10.915652, 122.617663, 100),
(2019, 'Concreting of Brgy. Jelicuon Lusaya FMR, Cabatuan, Iloilo', 'Brgy. Jelicuon Lusaya, Cabatuan, Iloilo', 'Cabatuan', 'Completed', 'February 24, 2020', 0.87, 10.907815, 122.525426, 10.909910, 122.518027, 100),
(2019, 'Concreting of Brgy. Polot-an FMR, Pototan, Iloilo', 'Brgy. Polot-an, Pototan, Iloilo', 'Pototan', 'Completed', 'February 24, 2020', 1.04, 11.008928, 122.697820, 11.010313, 122.693839, 100),
(2019, 'Concreting of Brgy. Mapili FMR, San Enrique, Iloilo', 'Brgy. Mapili, San Enrique, Iloilo', 'San Enrique', 'Completed', 'February 6, 2020', 0.52, 11.105534, 122.739462, 11.103388, 122.735452, 100),

-- 2020 Funded
(2020, 'Concreting of Brgy. Buyu-an FMR, Tigbauan, Iloilo', 'Brgy. Buyu-an, Tigbauan, Iloilo', 'Tigbauan', 'Completed', 'September 23, 2021', 0.79, 10.682572, 122.353445, 10.687758, 122.349369, 100),
(2020, 'Concreting of Brgy. Talayatay to Brgy. Lumangan FMR, Igbaras, Iloilo', 'Brgy. Talayatay and Brgy. Lumangan, Igbaras, Iloilo', 'Igbaras', 'Completed', 'September 23, 2021', 0.89, 10.708622, 122.232847, 10.714305, 122.229673, 100),
(2020, 'Concreting of Brgy. Tipolo FMR, Mina, Iloilo', 'Brgy. Tipolo, Mina, Iloilo', 'Mina', 'Completed', 'September 8, 2021', 0.74, 10.959706, 122.564314, 10.960006, 122.571915, 100),
(2020, 'Concreting of Brgy. Fundacion FMR, Duenas, Iloilo', 'Brgy. Fundacion, Duenas, Iloilo', 'Duenas', 'Completed', 'November 26, 2021', 0.63, 11.051626, 122.538343, 11.046350, 122.543760, 100),
(2020, 'Concreting of Sitio Arimayan, Brgy. Salngan FMR, Passi City, Iloilo', 'Brgy. Salngan, Passi City, Iloilo', 'Passi City', 'Completed', 'November 26, 2021', 0.83, 11.189222, 122.718403, 11.193322, 122.724222, 100),
(2020, 'Concreting of Sitio Hurog, Brgy. Jamul-awon FMR, Concepcion, Iloilo', 'Brgy. Jamul-awon, Concepcion, Iloilo', 'Concepcion', 'Completed', 'November 16, 2021', 0.80, 11.221406, 123.073105, 11.228251, 123.075679, 100),

-- 2021 Funded
(2021, 'Concreting of Sitio Guisian, Brgy. Tatoy FMR, Miag-ao, Iloilo', 'Brgy. Tatoy, Miag-ao, Iloilo', 'Miag-ao', 'Completed', 'March 15, 2022', 1.00, 10.664675, 122.260120, 10.672351, 122.264650, 100),
(2021, 'Concreting of Brgy. Sta. Monica to Brgy. Bita Norte FMR, Oton, Iloilo', 'Brgy. Sta. Monica and Brgy. Bita Norte, Oton, Iloilo', 'Oton', 'Completed', 'March 15, 2022', 1.50, 10.740661, 122.463077, 10.752985, 122.469965, 100),
(2021, 'Concreting of Brgy. Proper to Sitio Catugpan, Brgy. Sta. Monica FMR, Oton, Iloilo', 'Brgy. Sta. Monica, Oton, Iloilo', 'Oton', 'Completed', 'March 15, 2022', 0.82, 10.749633, 122.451475, 10.746700, 122.459468, 100),
(2021, 'Concreting of Brgy. Pitogo to Brgy. Cubay FMR, San Joaquin, Iloilo', 'Brgy. Pitogo and Brgy. Cubay, San Joaquin, Iloilo', 'San Joaquin', 'Completed', 'March 15, 2022', 0.77, 10.589674, 122.064136, 10.588340, 122.057583, 100),
(2021, 'Concreting of Brgy. Coline FMR, Alimodian, Iloilo', 'Brgy. Coline, Alimodian, Iloilo', 'Alimodian', 'Completed', 'June 15, 2022', 0.97, 10.823319, 122.459896, 10.821749, 122.468180, 100),
(2021, 'Concreting of Sitio Bugtong, Brgy. Consolacion, San Miguel to Sitio Itip, Brgy. Coline, Alimodian FMR', 'Brgy. Consolacion, San Miguel and Brgy. Coline, Alimodian, Iloilo', 'Alimodian', 'Completed', 'December 15, 2022', 1.17, 10.815252, 122.474037, 10.821162, 122.469389, 100),
(2021, 'Concreting of Brgy. Pajo FMR, Pototan, Iloilo', 'Brgy. Pajo, Pototan, Iloilo', 'Pototan', 'Completed', 'April 15, 2022', 0.99, 10.894765, 122.649011, 10.888396, 122.652309, 100),
(2021, 'Concreting of Brgy. Tolarucan FMR, Janiuay, Iloilo', 'Brgy. Tolarucan, Janiuay, Iloilo', 'Janiuay', 'Completed', 'October 15, 2022', 1.15, 10.932448, 122.545205, 10.926938, 122.540159, 100),
(2021, 'Concreting of Brgy. Guinhulacan FMR, Bingawan, Iloilo', 'Brgy. Guinhulacan, Bingawan, Iloilo', 'Bingawan', 'Completed', 'March 15, 2022', 1.05, 11.181698, 122.546124, 11.182644, 122.539574, 100),
(2021, 'Concreting of Brgy. Cayan Oeste FMR, Lambunao, Iloilo', 'Brgy. Cayan Oeste, Lambunao, Iloilo', 'Lambunao', 'Completed', 'April 15, 2022', 0.95, 11.035510, 122.454600, 11.032355, 122.447775, 100),

-- 2022 Funded
(2022, 'Concreting of Sitio Dolucutan, Brgy. Bitas FMR, Tigbauan, Iloilo', 'Brgy. Bitas, Tigbauan, Iloilo', 'Tigbauan', 'Completed', 'October 15, 2024', 0.80, 10.699058, 122.391286, 10.692155, 122.393457, 100),
(2022, 'Concreting of Brgy. Tibiao FMR, Calinog, Iloilo', 'Brgy. Tibiao, Calinog, Iloilo', 'Calinog', 'Completed', 'December 15, 2022', 0.70, 11.168441, 122.530626, 11.166858, 122.524621, 100),
(2022, 'Concreting of Brgy. Pangi FMR, San Dionisio, Iloilo', 'Brgy. Pangi, San Dionisio, Iloilo', 'San Dionisio', 'Completed', 'December 15, 2022', 0.26, 11.310470, 123.034862, 11.316652, 123.034390, 100),
(2022, 'Concreting of Brgy. Igsoligue to Brgy. Awang FMR, Miag-ao, Iloilo', 'Brgy. Igsoligue and Brgy. Awang, Miag-ao, Iloilo', 'Miag-ao', 'Completed', 'February 15, 2023', 0.85, 10.656196, 122.163543, 10.655043, 122.156767, 100),
(2022, 'Concreting of Brgy. Napnapan Sur FMR, Tigbauan, Iloilo', 'Brgy. Napnapan Sur, Tigbauan, Iloilo', 'Tigbauan', 'Completed', 'October 15, 2022', 1.00, 10.699504, 122.401511, 10.707508, 122.397222, 100),
(2022, 'Construction of Brgy. Bugang FMR, Alimodian, Iloilo', 'Brgy. Bugang, Alimodian, Iloilo', 'Alimodian', 'Completed', 'March 15, 2023', 0.89, 10.906135, 122.357114, 10.901779, 122.361814, 100),
(2022, 'Construction of Brgy. Lanit FMR, Iloilo City', 'Brgy. Lanit, Iloilo City', 'Iloilo City', 'Completed', 'January 15, 2023', 0.25, 10.769861, 122.563644, 10.765185, 122.564628, 100),
(2022, 'Concreting of Brgy. Naga FMR, Pototan, Iloilo', 'Brgy. Naga, Pototan, Iloilo', 'Pototan', 'Completed', 'July 15, 2023', 1.13, 10.887957, 122.633227, 10.898596, 122.630066, 100),
(2022, 'Concreting of WESVIARC, Hamungaya, Brgy. Buntatala FMR, Iloilo City', 'Brgy. Buntatala, Jaro, Iloilo City', 'Iloilo City', 'Completed', 'January 15, 2023', 0.77, 10.776446, 122.573584, 10.777414, 122.572183, 100),
(2022, 'Concreting of Brgy. Merced FMR, Banate, Iloilo', 'Brgy. Merced, Banate, Iloilo', 'Banate', 'Completed', 'December 15, 2022', 0.84, 11.026261, 122.815010, 11.032446, 122.818377, 100),

-- 2023 Funded
(2023, 'Concreting of Brgy. Igcadios to Brgy. Ayabang FMR, Leon, Iloilo', 'Brgy. Igcadios and Brgy. Ayabang, Leon, Iloilo', 'Leon', 'Completed', 'March 15, 2025', 0.69, 10.850151, 122.334492, 10.854621, 122.338371, 100),
(2023, 'Concreting of Sitio Ubos to Lapayon Proper, Brgy. Lapayon FMR, Leganes, Iloilo', 'Brgy. Lapayon, Leganes, Iloilo', 'Leganes', 'Completed', 'May 15, 2025', 0.85, 10.791750, 122.574541, 10.798951, 122.568586, 100),
(2023, 'Concreting of Brgy. Dalid FMR, Calinog, Iloilo', 'Brgy. Dalid, Calinog, Iloilo', 'Calinog', 'Completed', 'October 15, 2024', 0.71, 11.112357, 122.538726, 11.107355, 122.537662, 100),
(2023, 'Concreting of Brgy. Danao FMR, Janiuay, Iloilo', 'Brgy. Danao, Janiuay, Iloilo', 'Janiuay', 'Completed', 'March 15, 2024', 0.92, 10.965543, 122.459691, 10.973635, 122.448975, 100),
(2023, 'Concreting of Sitio Agtalos to Sitio Andagao, Brgy. San Juan Crisostomo FMR, Anilao, Iloilo', 'Brgy. San Juan Crisostomo, Anilao, Iloilo', 'Anilao', 'Completed', 'October 15, 2023', 0.99, 10.953083, 122.711005, 10.955618, 122.704211, 100),
(2023, 'Concreting of Brgy. Silagon FMR, Ajuy, Iloilo', 'Brgy. Silagon, Ajuy, Iloilo', 'Ajuy', 'Completed', 'March 15, 2024', 0.76, 11.168443, 123.065390, 11.165612, 123.074044, 100),
(2023, 'Concreting of Brgy. Tupaz FMR, Carles, Iloilo', 'Brgy. Tupaz, Carles, Iloilo', 'Carles', 'Completed', 'March 15, 2024', 1.00, 11.509619, 123.099794, 11.512222, 123.109031, 100),
(2023, 'Concreting of Sitio Ipil-ipil, Brgy. Ardemil FMR, Sara, Iloilo', 'Brgy. Ardemil, Sara, Iloilo', 'Sara', 'Completed', 'March 15, 2024', 0.52, 11.325196, 122.964170, 11.323543, 122.959373, 100),
(2023, 'Concreting of Brgy. Adgao to Brgy. Tabat FMR, Tubungan, Iloilo', 'Brgy. Adgao and Brgy. Tabat, Tubungan, Iloilo', 'Tubungan', 'Completed', 'October 15, 2024', 0.95, 10.742942, 122.318756, 10.748741, 122.313529, 100),
(2023, 'Concreting of Brgy. Poblacion 5 (Cayap) to Brgy. Kinagdan FMR, Igbaras, Iloilo', 'Brgy. Poblacion 5 (Cayap) and Brgy. Kinagdan, Igbaras, Iloilo', 'Igbaras', 'Completed', 'October 15, 2024', 0.97, 10.725831, 122.253198, 10.730507, 122.246649, 100);

-- ============================================================
-- Done! Total: 96 historical completed projects inserted (2014-2023)
-- These complement the 2024 completed projects already in the
-- supabase_fmr_projects_migration.sql file
-- ============================================================
