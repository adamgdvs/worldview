export interface Landmark {
  name: string
  lat: number
  lon: number
  height: number
  heading: number
  pitch: number
}

/** 6 landmarks per city. First entry = most popular = default flyTo target. */
export const LANDMARKS: Record<string, Landmark[]> = {
  'Austin': [
    { name: 'Texas Capitol',       lat: 30.2715, lon: -97.7397, height: 262,  heading: 348, pitch: -18 },
    { name: 'Zilker Park',         lat: 30.2636, lon: -97.7722, height: 255,  heading: 320, pitch: -42 },
    { name: 'Lady Bird Lake',      lat: 30.2525, lon: -97.7418, height: 292,  heading: 343, pitch: -16 },
    { name: 'UT Tower',            lat: 30.2844, lon: -97.7408, height: 245,  heading: 35,  pitch: -17 },
    { name: 'Congress Bridge',     lat: 30.2598, lon: -97.7446, height: 174,  heading: 334, pitch: -23 },
    { name: 'Domain',              lat: 30.3984, lon: -97.7246, height: 287,  heading: 342, pitch: -14 },
  ],
  'San Francisco': [
    { name: 'Golden Gate Bridge',  lat: 37.8282, lon: -122.4780, height: 103,  heading: 193, pitch: 3 },
    { name: 'Transamerica Pyramid',lat: 37.7920, lon: -122.4053, height: 212,  heading: 26,  pitch: -13 },
    { name: 'Alcatraz Island',     lat: 37.8221, lon: -122.4229, height: 110,  heading: 6,   pitch: -9 },
    { name: 'Salesforce Tower',    lat: 37.7847, lon: -122.3975, height: 249,  heading: 8,   pitch: -10 },
    { name: 'Fishermans Wharf',    lat: 37.8048, lon: -122.4177, height: 210,  heading: 351, pitch: -24 },
    { name: 'Twin Peaks',          lat: 37.7544, lon: -122.4477, height: 500,  heading: 0,   pitch: -30 },
  ],
  'New York': [
    { name: 'Statue of Liberty',   lat: 40.6876, lon: -74.0447, height: 100,  heading: 0,   pitch: -25 },
    { name: 'Empire State',        lat: 40.7430, lon: -73.9833, height: 328,  heading: 343, pitch: -13 },
    { name: 'Central Park',        lat: 40.7824, lon: -73.9590, height: 600,  heading: 360, pitch: -30 },
    { name: 'Times Square',        lat: 40.7582, lon: -73.9854, height: 100,  heading: 13,  pitch: -23 },
    { name: 'Brooklyn Bridge',     lat: 40.7015, lon: -73.9950, height: 106,  heading: 355, pitch: -8 },
    { name: 'One World Trade',     lat: 40.7104, lon: -74.0153, height: 283,  heading: 56,  pitch: -54 },
  ],
  'Tokyo': [
    { name: 'Tokyo Tower',         lat: 35.6538, lon: 139.7466, height: 215,  heading: 347, pitch: 0 },
    { name: 'Shibuya Crossing',    lat: 35.6582, lon: 139.7006, height: 171,  heading: 360, pitch: -30 },
    { name: 'Senso-ji Temple',     lat: 35.7138, lon: 139.7945, height: 105,  heading: 63,  pitch: -13 },
    { name: 'Skytree',             lat: 35.7031, lon: 139.8051, height: 148,  heading: 30,  pitch: 11 },
    { name: 'Imperial Palace',     lat: 35.6806, lon: 139.7547, height: 138,  heading: 332, pitch: -18 },
    { name: 'Meiji Shrine',        lat: 35.6741, lon: 139.6995, height: 148,  heading: 360, pitch: -25 },
  ],
  'London': [
    { name: 'Big Ben',             lat: 51.4998, lon: -0.1258, height: 116,  heading: 41,  pitch: -6 },
    { name: 'Tower Bridge',        lat: 51.5034, lon: -0.0739, height: 152,  heading: 338, pitch: -11 },
    { name: 'Buckingham Palace',   lat: 51.4993, lon: -0.1440, height: 161,  heading: 28,  pitch: -26 },
    { name: 'London Eye',          lat: 51.5025, lon: -0.1234, height: 244,  heading: 73,  pitch: -30 },
    { name: 'The Shard',           lat: 51.5004, lon: -0.0833, height: 288,  heading: 337, pitch: -10 },
    { name: 'St Pauls Cathedral',  lat: 51.5119, lon: -0.0985, height: 198,  heading: 0,   pitch: -25 },
  ],
  'Paris': [
    { name: 'Eiffel Tower',        lat: 48.8534, lon: 2.2954, height: 226,  heading: 355, pitch: 1 },
    { name: 'Arc de Triomphe',     lat: 48.8716, lon: 2.2969, height: 210,  heading: 329, pitch: -23 },
    { name: 'Notre-Dame',          lat: 48.8502, lon: 2.3519, height: 203,  heading: 338, pitch: -18 },
    { name: 'Louvre Museum',        lat: 48.8580, lon: 2.3384, height: 169,  heading: 360, pitch: -25 },
    { name: 'Sacre-Coeur',         lat: 48.8830, lon: 2.3432, height: 227,  heading: 357, pitch: -12 },
    { name: 'Champs-Elysees',      lat: 48.8660, lon: 2.3072, height: 190,  heading: 0,   pitch: -25 },
  ],
  'Dubai': [
    { name: 'Burj Khalifa',        lat: 25.1988, lon: 55.2738, height: 459,  heading: 178, pitch: -59 },
    { name: 'Palm Jumeirah',        lat: 25.0593, lon: 55.1352, height: 3473, heading: 360, pitch: -35 },
    { name: 'Burj Al Arab',        lat: 25.1413, lon: 55.1853, height: 342,  heading: 49,  pitch: -85 },
    { name: 'Dubai Frame',          lat: 25.2365, lon: 55.2991, height: 320,  heading: 167, pitch: -59 },
    { name: 'Dubai Marina',         lat: 25.0752, lon: 55.1406, height: 154,  heading: 3,   pitch: -21 },
    { name: 'Mall of Emirates',     lat: 25.1157, lon: 55.2003, height: 659,  heading: 5,   pitch: -72 },
  ],
  'Washington DC': [
    { name: 'US Capitol',           lat: 38.8898, lon: -77.0047, height: 120,  heading: 269, pitch: -12 },
    { name: 'White House',          lat: 38.8999, lon: -77.0366, height: 101,  heading: 179, pitch: -17 },
    { name: 'Lincoln Memorial',     lat: 38.8895, lon: -77.0471, height: 100,  heading: 265, pitch: -20 },
    { name: 'Washington Monument',  lat: 38.8874, lon: -77.0373, height: 104,  heading: 37,  pitch: -10 },
    { name: 'Pentagon',             lat: 38.8656, lon: -77.0558, height: 356,  heading: 360, pitch: -35 },
    { name: 'Jefferson Memorial',   lat: 38.8794, lon: -77.0364, height: 100,  heading: 0,   pitch: -25 },
  ],
  'Hong Kong': [
    { name: 'Victoria Peak',        lat: 22.2733, lon: 114.1527, height: 669,  heading: 278, pitch: -20 },
    { name: 'Victoria Harbour',     lat: 22.2648, lon: 114.1712, height: 1401, heading: 0,   pitch: -25 },
    { name: 'Tian Tan Buddha',      lat: 22.2541, lon: 113.9052, height: 651,  heading: 243, pitch: -82 },
    { name: 'Star Ferry Pier',      lat: 22.2912, lon: 114.1687, height: 127,  heading: 0,   pitch: -25 },
    { name: 'ICC Tower',            lat: 22.2957, lon: 114.1619, height: 388,  heading: 351, pitch: -11 },
    { name: 'Temple Street',        lat: 22.3053, lon: 114.1702, height: 106,  heading: 360, pitch: -25 },
  ],
  'Singapore': [
    { name: 'Marina Bay Sands',     lat: 1.2796, lon: 103.8619, height: 348,  heading: 351, pitch: -29 },
    { name: 'Gardens by the Bay',   lat: 1.2783, lon: 103.8636, height: 169,  heading: 360, pitch: -25 },
    { name: 'Merlion Park',         lat: 1.2839, lon: 103.8555, height: 108,  heading: 321, pitch: -14 },
    { name: 'Sentosa Island',       lat: 1.2433, lon: 103.8335, height: 1011, heading: 0,   pitch: -30 },
    { name: 'Orchard Road',         lat: 1.3009, lon: 103.8329, height: 228,  heading: 343, pitch: -18 },
    { name: 'Changi Airport',       lat: 1.3711, lon: 103.9986, height: 2831, heading: 294, pitch: -89 },
  ],
}

export const LANDMARK_KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y'] as const
