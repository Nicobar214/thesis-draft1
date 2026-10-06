// Leon, Iloilo barangays with verified map positions, so map search can answer
// instantly and offline-first instead of asking a web geocoder, which has
// mis-placed several of these (see supabase_fix_leon_farmer_locations.sql).
//
// Positions come from OpenStreetMap place nodes (scripts/barangay_geocode_cache.json).
// approx: true marks the two barangays OpenStreetMap does not list as a place;
// their position is an estimate.

const LEON_BARANGAYS = [
  {
    name: 'Agboy Norte',
    lat: 10.773423,
    lng: 122.419426
  },
  {
    name: 'Agboy Sur',
    lat: 10.768615,
    lng: 122.41132
  },
  {
    name: 'Agta',
    lat: 10.82884,
    lng: 122.340116
  },
  {
    name: 'Ambulong',
    lat: 10.773947,
    lng: 122.34302
  },
  {
    name: 'Anonang',
    lat: 10.766911,
    lng: 122.400379
  },
  {
    name: 'Apian',
    lat: 10.823624,
    lng: 122.347217
  },
  {
    name: 'Avanzada',
    lat: 10.772613,
    lng: 122.347606
  },
  {
    name: 'Awis',
    lat: 10.812269,
    lng: 122.372548
  },
  {
    name: 'Ayabang',
    lat: 10.856632,
    lng: 122.333695
  },
  {
    name: 'Bacolod',
    lat: 10.86532,
    lng: 122.296371
  },
  {
    name: 'Baje',
    lat: 10.785252,
    lng: 122.3406,
    approx: true
  },
  {
    name: 'Banagan',
    lat: 10.873659,
    lng: 122.347099
  },
  {
    name: 'Barangbang',
    lat: 10.816982,
    lng: 122.33109
  },
  {
    name: 'Barasan',
    lat: 10.787066,
    lng: 122.373876
  },
  {
    name: 'Bayag Norte',
    lat: 10.769602,
    lng: 122.349619
  },
  {
    name: 'Bayag Sur',
    lat: 10.768153,
    lng: 122.353603
  },
  {
    name: 'Binolbog',
    lat: 10.777978,
    lng: 122.341743,
    approx: true
  },
  {
    name: 'Bobon',
    lat: 10.894937,
    lng: 122.29388
  },
  {
    name: 'Bucari',
    lat: 10.869241,
    lng: 122.288789
  },
  {
    name: 'Buenavista',
    lat: 10.756499,
    lng: 122.41184
  },
  {
    name: 'Buga',
    lat: 10.808616,
    lng: 122.390721
  },
  {
    name: 'Bulad',
    lat: 10.812594,
    lng: 122.361188
  },
  {
    name: 'Bulwang',
    lat: 10.888467,
    lng: 122.300252
  },
  {
    name: 'Cabolo-an',
    lat: 10.887559,
    lng: 122.314853,
    aliases: [
      'Cabolo an'
    ]
  },
  {
    name: 'Cabunga-an',
    lat: 10.882257,
    lng: 122.308599,
    aliases: [
      'Cabunga an'
    ]
  },
  {
    name: 'Cabutongan',
    lat: 10.782808,
    lng: 122.349088
  },
  {
    name: 'Cagay',
    lat: 10.86532,
    lng: 122.296371
  },
  {
    name: 'Camandag',
    lat: 10.887691,
    lng: 122.293271
  },
  {
    name: 'Camando',
    lat: 10.804779,
    lng: 122.381862
  },
  {
    name: 'Cananaman',
    lat: 10.795218,
    lng: 122.334628
  },
  {
    name: 'Capt. Fernando',
    lat: 10.805224,
    lng: 122.370312,
    aliases: [
      'Captain Fernando',
      'Capitan Fernando'
    ]
  },
  {
    name: 'Carara-an',
    lat: 10.843348,
    lng: 122.342151,
    aliases: [
      'Carara an'
    ]
  },
  {
    name: 'Carolina',
    lat: 10.796833,
    lng: 122.351861
  },
  {
    name: 'Cawilihan',
    lat: 10.841587,
    lng: 122.313553
  },
  {
    name: 'Coyugan Norte',
    lat: 10.826194,
    lng: 122.351402
  },
  {
    name: 'Coyugan Sur',
    lat: 10.814209,
    lng: 122.337564
  },
  {
    name: 'Danao',
    lat: 10.852499,
    lng: 122.284779
  },
  {
    name: 'Dorog',
    lat: 10.834896,
    lng: 122.333194
  },
  {
    name: 'Dusacan',
    lat: 10.83106,
    lng: 122.348914
  },
  {
    name: 'Gines',
    lat: 10.856514,
    lng: 122.342316
  },
  {
    name: 'Gumboc',
    lat: 10.804028,
    lng: 122.359448
  },
  {
    name: 'Igcadios',
    lat: 10.847879,
    lng: 122.337798
  },
  {
    name: 'Ingay',
    lat: 10.841611,
    lng: 122.293412
  },
  {
    name: 'Isian Norte',
    lat: 10.767052,
    lng: 122.366362
  },
  {
    name: 'Isian Victoria',
    lat: 10.791655,
    lng: 122.357898
  },
  {
    name: 'Jamog Gines',
    lat: 10.765206,
    lng: 122.356742
  },
  {
    name: 'Lampaya',
    lat: 10.877598,
    lng: 122.324927
  },
  {
    name: 'Lanag',
    lat: 10.796454,
    lng: 122.393929
  },
  {
    name: 'Lang-og',
    lat: 10.796456,
    lng: 122.365779,
    aliases: [
      'Lang og'
    ]
  },
  {
    name: 'Ligtos',
    lat: 10.82981,
    lng: 122.364964
  },
  {
    name: 'Lonoc',
    lat: 10.783137,
    lng: 122.34169
  },
  {
    name: 'Magcapay',
    lat: 10.816384,
    lng: 122.360321
  },
  {
    name: 'Maliao',
    lat: 10.873087,
    lng: 122.319127
  },
  {
    name: 'Malublub',
    lat: 10.839468,
    lng: 122.364352
  },
  {
    name: 'Manampunay',
    lat: 10.804405,
    lng: 122.331625
  },
  {
    name: 'Marirong',
    lat: 10.827,
    lng: 122.321667
  },
  {
    name: 'Mina',
    lat: 10.774233,
    lng: 122.342697
  },
  {
    name: 'Mocol',
    lat: 10.810499,
    lng: 122.344979
  },
  {
    name: 'Nagbangi',
    lat: 10.786363,
    lng: 122.399744
  },
  {
    name: 'Nalbang',
    lat: 10.823607,
    lng: 122.335476
  },
  {
    name: 'Odong-odong',
    lat: 10.789522,
    lng: 122.350388,
    aliases: [
      'Odong odong'
    ]
  },
  {
    name: 'Oluangan',
    lat: 10.822036,
    lng: 122.369347
  },
  {
    name: 'Omambong',
    lat: 10.751934,
    lng: 122.393996
  },
  {
    name: 'Paga',
    lat: 10.799474,
    lng: 122.328431
  },
  {
    name: 'Pandan',
    lat: 10.762823,
    lng: 122.402521
  },
  {
    name: 'Panginman',
    lat: 10.777733,
    lng: 122.378932
  },
  {
    name: 'Paoy',
    lat: 10.812346,
    lng: 122.377229
  },
  {
    name: 'Pepe',
    lat: 10.789323,
    lng: 122.335933
  },
  {
    name: 'Poblacion',
    lat: 10.780051,
    lng: 122.386584
  },
  {
    name: 'Salngan',
    lat: 10.78243,
    lng: 122.364584
  },
  {
    name: 'Samlague',
    lat: 10.810698,
    lng: 122.349761
  },
  {
    name: 'Siol Norte',
    lat: 10.776147,
    lng: 122.405278
  },
  {
    name: 'Siol Sur',
    lat: 10.776147,
    lng: 122.405278
  },
  {
    name: 'Tacuyong Norte',
    lat: 10.820716,
    lng: 122.323107
  },
  {
    name: 'Tacuyong Sur',
    lat: 10.80546,
    lng: 122.34815
  },
  {
    name: 'Tagsing',
    lat: 10.847958,
    lng: 122.327824
  },
  {
    name: 'Talacuan',
    lat: 10.774417,
    lng: 122.389445,
    aliases: [
      'Talacu-an'
    ]
  },
  {
    name: 'Ticuan',
    lat: 10.858215,
    lng: 122.348863
  },
  {
    name: 'Tina-an Norte',
    lat: 10.827489,
    lng: 122.375029,
    aliases: [
      'Tinaan Norte'
    ]
  },
  {
    name: 'Tina-an Sur',
    lat: 10.77611,
    lng: 122.373345,
    aliases: [
      'Tinaan Sur'
    ]
  },
  {
    name: 'Tu-og',
    lat: 10.785376,
    lng: 122.411788,
    aliases: [
      'Tu og'
    ]
  },
  {
    name: 'Tunguan',
    lat: 10.8708,
    lng: 122.3339
  }
];

export default LEON_BARANGAYS;
