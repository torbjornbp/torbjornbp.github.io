import { localName } from "./labels.js";

export const COUNTRY_ISO = {
  Afghanistan: "AFG", Albania: "ALB", Algeria: "DZA", Angola: "AGO",
  Argentina: "ARG", Armenia: "ARM", Australia: "AUS", Austria: "AUT",
  Azerbaijan: "AZE", Bahamas: "BHS", Bangladesh: "BGD", Belarus: "BLR",
  Belgium: "BEL", Benin: "BEN", Bermuda: "BMU", Bhutan: "BTN",
  BoliviaPlurinationalStateOf: "BOL", BosniaAndHerzegovina: "BIH",
  Brazil: "BRA", Bulgaria: "BGR", BurkinaFaso: "BFA", CaboVerde: "CPV",
  Cameroon: "CMR", Canada: "CAN", CaymanIslands: "CYM", Chad: "TCD",
  Chile: "CHL", China: "CHN", Colombia: "COL",
  CongoDemocraticRepublicOfThe: "COD", CostaRica: "CRI", CoteDivoire: "CIV",
  Croatia: "HRV", Cuba: "CUB",
  Cyprus: "CYP", Czechia: "CZE", Denmark: "DNK", DominicanRepublic: "DOM",
  Ecuador: "ECU", Egypt: "EGY", Estonia: "EST", Ethiopia: "ETH",
  FaroeIslands: "FRO", Finland: "FIN", France: "FRA", Gabon: "GAB",
  Georgia: "GEO", Germany: "DEU", Ghana: "GHA", Greece: "GRC",
  Greenland: "GRL", Guatemala: "GTM", Guinea: "GIN", GuineaBissau: "GNB",
  HongKong: "HKG", Hungary: "HUN", Iceland: "ISL", India: "IND",
  Indonesia: "IDN", IranIslamicRepublicOf: "IRN", Iraq: "IRQ",
  Ireland: "IRL", IsleOfMan: "IMN", Israel: "ISR", Italy: "ITA",
  Jamaica: "JAM", Japan: "JPN", Jordan: "JOR", Kazakhstan: "KAZ",
  Kenya: "KEN", KoreaRepublicOf: "KOR", Kuwait: "KWT", Kyrgyzstan: "KGZ",
  Latvia: "LVA", Lebanon: "LBN", Lesotho: "LSO", Liechtenstein: "LIE",
  Lithuania: "LTU",
  Luxembourg: "LUX", Madagascar: "MDG", Malaysia: "MYS", Malta: "MLT",
  Martinique: "MTQ", Mexico: "MEX", MoldovaRepublicOf: "MDA",
  Monaco: "MCO", Mongolia: "MNG", Montenegro: "MNE", Morocco: "MAR",
  Mozambique: "MOZ", Myanmar: "MMR", Namibia: "NAM", Nepal: "NPL",
  NetherlandsKingdomOfThe: "NLD", NewZealand: "NZL", Nicaragua: "NIC",
  Niger: "NER", Nigeria: "NGA", NorthMacedonia: "MKD", Norway: "NOR",
  Pakistan: "PAK", PalestineStateOf: "PSE", Panama: "PAN",
  Paraguay: "PRY", Peru: "PER", Philippines: "PHL", Poland: "POL",
  Portugal: "PRT", PuertoRico: "PRI", Qatar: "QAT", Romania: "ROU",
  RussianFederation: "RUS", Rwanda: "RWA", SaudiArabia: "SAU",
  Senegal: "SEN", Serbia: "SRB", Singapore: "SGP", Slovakia: "SVK",
  Slovenia: "SVN", Somalia: "SOM", SouthAfrica: "ZAF",
  SovietUnion: "SUN", Spain: "ESP", SriLanka: "LKA", Sudan: "SDN",
  Sweden: "SWE", Switzerland: "CHE", SyrianArabRepublic: "SYR",
  TaiwanProvinceOfChina: "TWN", Tajikistan: "TJK",
  TanzaniaUnitedRepublicOf: "TZA", Thailand: "THA",
  TrinidadAndTobago: "TTO", Tunisia: "TUN", Turkiye: "TUR",
  Turkmenistan: "TKM", Ukraine: "UKR", UnitedArabEmirates: "ARE",
  UnitedKingdomOfGreatBritainAndNorthernIreland: "GBR",
  UnitedStatesOfAmerica: "USA", Uruguay: "URY", Uzbekistan: "UZB",
  VenezuelaBolivarianRepublicOf: "VEN", VietNam: "VNM",
  Yugoslavia: "YUG", Zambia: "ZMB", Zimbabwe: "ZWE"
};

// ISO code for a FIAF country IRI, or null when the vocabulary is unknown.
export function countryIso(iri) {
  return COUNTRY_ISO[localName(iri)] || null;
}
