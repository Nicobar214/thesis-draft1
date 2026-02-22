/**
 * iloiloLocations.js
 * Structured location hierarchy for Region VI – Iloilo Province.
 * Municipality → Barangay mapping with optional street/sitio lists.
 */

const ILOILO_LOCATIONS = {
  region: 'Region VI – Western Visayas',
  province: 'Iloilo',
  municipalities: {
    Ajuy: {
      barangays: ['Badiangan', 'Luca', 'Mangorocoro', 'Nasidman', 'Pili', 'Poblacion', 'Rosal', 'San Jose', 'Tagubanhan', 'Tipacla'],
    },
    Alimodian: {
      barangays: ['Atabay', 'Ba-ong', 'Bancal', 'Binaluan', 'Bugang', 'Dalid', 'Libo-on', 'Poblacion', 'San Andres', 'Sinamay'],
    },
    Anilao: {
      barangays: ['Balabag', 'Cag-an', 'Camiros', 'Dalipe', 'Poblacion', 'San Carlos', 'San Juan', 'Santa Cruz', 'Vista Alegre'],
    },
    Badiangan: {
      barangays: ['Baga-as', 'Cabayugan', 'Condaya', 'Laylayan', 'Poblacion', 'San Agustin', 'San Fernando', 'Suso', 'Talokgangan'],
    },
    Balasan: {
      barangays: ['Calamigan', 'Cecilia', 'Hernando', 'Lawis', 'Poblacion Norte', 'Poblacion Sur', 'San Roque', 'Tingui-an', 'Hacienda'],
    },
    Banate: {
      barangays: ['Bantayan', 'Bagumbayan', 'De la Paz', 'Juanico', 'Medina', 'Merced', 'Poblacion', 'San Salvador', 'Talotoan'],
    },
    'Barotac Nuevo': {
      barangays: ['Acuit', 'Agbobolo', 'Baras', 'Caloocan', 'Ilaud', 'Lagubang', 'Poblacion', 'San Antonio', 'San Rafael', 'Solong'],
    },
    'Barotac Viejo': {
      barangays: ['Bugnay', 'General Luna', 'Lico-an', 'Natividad', 'Poblacion', 'San Juan', 'San Roque', 'Torreblanca', 'Vista Alegre'],
    },
    Batad: {
      barangays: ['Alapasco', 'Alinsolong', 'Banban', 'Binon-an', 'Bolho', 'Nangka', 'Poblacion', 'Salong', 'Tanag'],
    },
    Cabatuan: {
      barangays: ['Banguit', 'Bulay', 'Duyanduyan', 'Gines', 'Jelicuon', 'Libo-on', 'Maguina', 'Poblacion', 'Salgan', 'Tabucan', 'Tigbauan'],
    },
    Calinog: {
      barangays: ['Agcalaga', 'Baguingin', 'Cahigon', 'Dalid', 'Garangan', 'Impalidan', 'Malitbog', 'Poblacion', 'Simsiman', 'Toyungan'],
    },
    Carles: {
      barangays: ['Abong-Abong', 'Bacan', 'Bancal-Bancal', 'Binuluangan', 'Bito-on', 'Buaya', 'Cabilao', 'Pantalan', 'Poblacion', 'Talingting'],
    },
    Concepcion: {
      barangays: ['Aglosong', 'Bagongon', 'Bagumbayan', 'Botlog', 'Calamigan', 'Dungon', 'Malapoc', 'Poblacion', 'Talotu-an', 'Tambaliza'],
    },
    Dingle: {
      barangays: ['Abangay', 'Caguyuman', 'Dawis', 'Ginalinan', 'Jibolo', 'Lanas', 'Matag-ub', 'Poblacion', 'Sinaba', 'Tabucol'],
    },
    'Dueñas': {
      barangays: ['Cagban', 'Cabubugan', 'Calicuang', 'Jacinto', 'Lapayon', 'Miagao', 'Poblacion', 'San Miguel', 'Tambal', 'Tinocuan'],
    },
    Dumangas: {
      barangays: ['Bacong', 'Balabag', 'Calao', 'Ermita', 'Ilaya', 'Jardin', 'Maquina', 'Pagdugue', 'Poblacion', 'Sapao', 'Tabucan'],
    },
    Estancia: {
      barangays: ['Botongon', 'Bulaqueña', 'Calapdan', 'Daan Banua', 'Gogo', 'Lumangan', 'Pilar', 'Poblacion Zone 1', 'Poblacion Zone 2', 'Tanza'],
    },
    Guimbal: {
      barangays: ['Abeto', 'Buyu-an', 'Cabasi', 'Gilman', 'Iba', 'Nalundan', 'Narra', 'Poblacion', 'Rizal', 'Sipitan'],
    },
    Igbaras: {
      barangays: ['Alameda', 'Bagumbayan', 'Calampitao', 'Crespo', 'Inabasan', 'Mambawi', 'Passi', 'Poblacion', 'Talongonan', 'Ubos'],
    },
    'Iloilo City': {
      barangays: ['Arevalo', 'City Proper', 'Jaro', 'La Paz', 'Lapuz', 'Mandurriao', 'Molo', 'San Pedro', 'Santa Cruz', 'Tabuc Suba', 'Villa Arevalo'],
    },
    Janiuay: {
      barangays: ['Abeto', 'Barasalon', 'Cabesa', 'Daanbanwa', 'Ginalinan', 'Hamili', 'Lanag', 'Malusgod', 'Poblacion', 'Quipot', 'Tambal'],
    },
    Lambunao: {
      barangays: ['Agsirab', 'Cabagiao', 'Cagay', 'Gines', 'Jayubo', 'Misi', 'Pandan', 'Poblacion', 'Salngan', 'Tabucan'],
    },
    Leganes: {
      barangays: ['Bigke', 'Buntatala', 'Calaboa', 'Cari Mayor', 'Gua-an', 'Nabitasan', 'Pandan', 'Poblacion', 'San Vicente'],
    },
    Lemery: {
      barangays: ['Agtatacay', 'Atipulu-an', 'Cabantohan', 'Ito', 'Nagsulang', 'Naslo', 'Poblacion', 'Rosal', 'Timpas'],
    },
    Leon: {
      barangays: ['Agboy', 'Bucari', 'Camandag', 'Doldol', 'Guiso', 'Mabini', 'Mapili', 'Poblacion', 'San Isidro', 'Siol'],
    },
    Maasin: {
      barangays: ['Abay', 'Alibunan', 'Bagumbayan', 'Bolo', 'Dagami', 'Libo-on', 'Naslo', 'Poblacion', 'Sambag', 'Tigbauan'],
    },
    Miagao: {
      barangays: ['Baybay Norte', 'Baybay Sur', 'Bolho', 'Cagay', 'Damilisan', 'Guibongan', 'Kirayan Norte', 'Kirayan Sur', 'Poblacion', 'San Fernando', 'Tacas'],
    },
    Mina: {
      barangays: ['Agdayao', 'Ambarihon', 'Balit', 'Cabagiao', 'Cabano', 'Guiso', 'Lumanay', 'Naclub', 'Poblacion', 'Singon'],
    },
    'New Lucena': {
      barangays: ['Baclayan', 'Badiang', 'Balabag', 'Calumangan', 'Dawis', 'General Luna', 'Pasol-o', 'Poblacion', 'Wari-Wari'],
    },
    Oton: {
      barangays: ['Abilay Norte', 'Abilay Sur', 'Botong', 'Buray', 'Caboloan', 'Poblacion East', 'Poblacion West', 'San Antonio', 'San Nicolas', 'Trapiche'],
    },
    'Passi City': {
      barangays: ['Agtuman', 'Bacuranan', 'Bolo', 'Cabunga', 'Dalicanan', 'Gemat-y', 'Jamog', 'Man-it', 'Magdungao', 'Poblacion Ilawod', 'Poblacion Ilaya', 'Sag-ang'],
    },
    Pavia: {
      barangays: ['Aganan', 'Anilao', 'Balabag', 'Cabugao Norte', 'Cabugao Sur', 'Jibolo', 'Pandac', 'Poblacion', 'Purok 1', 'Ungka'],
    },
    Pototan: {
      barangays: ['Abangay', 'Amamaros', 'Bagacay', 'Caboloan', 'Cawayan', 'Guibuangan', 'Imbang', 'Nanga', 'Poblacion', 'Primitivo Ledesma'],
    },
    'San Dionisio': {
      barangays: ['Agdaliran', 'Batuan', 'Cabilauan', 'Cubay', 'Cap-ac', 'Madanlog', 'Mton', 'Nagsulang', 'Poblacion', 'Tabugon'],
    },
    'San Enrique': {
      barangays: ['Abaca', 'Bago', 'Mapili', 'Misi', 'Dacutan', 'Pal-agon', 'Poblacion Ilawod', 'Poblacion Ilaya', 'San Jose'],
    },
    'San Joaquin': {
      barangays: ['Amboyu-an', 'Cadoldolan', 'Casay', 'Dolores', 'Ilaya', 'Nasidman', 'Nipa', 'Poblacion', 'San Juan', 'Tigbauan'],
    },
    'San Miguel': {
      barangays: ['Bolho', 'Calao', 'Camandag', 'Igcocolo', 'Intosan', 'Miagao', 'Poblacion', 'San Jose', 'Sibaguan'],
    },
    'San Rafael': {
      barangays: ['Acuit', 'Bolho', 'Cabayogan', 'Dolores', 'Poblacion', 'San Agustin', 'San Roque', 'Villa'],
    },
    'Santa Barbara': {
      barangays: ['Bagumbayan', 'Bolong Oeste', 'Buyu-an', 'Dawis', 'Jibolo', 'Poblacion', 'San Angel', 'San Sebastian', 'Supang', 'Tugas'],
    },
    Sara: {
      barangays: ['Aguirre', 'Aranjuez', 'Bagumbayan', 'Concepcion', 'Del Castillo', 'Juanico', 'Libo-on', 'Poblacion Norte', 'Poblacion Sur', 'Taminla'],
    },
    Tigbauan: {
      barangays: ['Bagumbayan', 'Barangay 1', 'Buyu-an', 'Cordova Norte', 'Cordova Sur', 'Iyasan', 'Nabitasan', 'Napnapan Norte', 'Napnapan Sur', 'Poblacion'],
    },
    Tubungan: {
      barangays: ['Aglalana', 'Atabay', 'Bolho', 'Cadoldolan', 'Colob-o', 'Dinginan', 'Igbita', 'Inaladan', 'Poblacion', 'Tambal'],
    },
    Zarraga: {
      barangays: ['Balud', 'Dawis', 'Gines', 'Ilawod', 'Jalaud Norte', 'Jalaud Sur', 'Poblacion', 'Sigangao', 'Talauguis', 'Tuburan'],
    },
  },
};

/**
 * Returns sorted array of municipality names.
 */
export function getMunicipalities() {
  return Object.keys(ILOILO_LOCATIONS.municipalities).sort();
}

/**
 * Returns sorted array of barangays for a given municipality.
 */
export function getBarangays(municipality) {
  const m = ILOILO_LOCATIONS.municipalities[municipality];
  return m ? [...m.barangays].sort() : [];
}

export default ILOILO_LOCATIONS;
