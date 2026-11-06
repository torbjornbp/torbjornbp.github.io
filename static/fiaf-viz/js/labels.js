// Display names for FIAFcore classes.
//
// FIAFcore IRIs are camel-cased local names (fiaf:FeatureFilm, fiaf:CastMember).
// The graph carries no labels for the vocabulary classes, so the UI humanizes
// the local name and keeps a small, explicit map for the terms where that is
// not enough. Keep this map curated: it is presentation only.

export const FIAF_NS = "https://dev.fiafcore.org/";

const LABELS = {
  // credits / roles
  Director: "Director",
  Producer: "Producer",
  ExecutiveProducer: "Executive producer",
  Coproducer: "Co-producer",
  CastMember: "Cast member",
  Writer: "Writer",
  Screenplay: "Screenplay",
  Composer: "Composer",
  Cinematographer: "Cinematographer",
  CameraOperator: "Camera operator",
  FilmEditor: "Film editor",
  ProductionCompany: "Production company",
  ProductionManager: "Production manager",
  ProductionDesigner: "Production designer",
  ProductionDesignActivity: "Production design",
  ArtDirector: "Art director",
  CostumeDesigner: "Costume designer",
  MakeUpArtist: "Make-up artist",
  SoundActivity: "Sound",
  MusicPerformer: "Music performer",
  MusicConductor: "Conductor",
  Narrator: "Narrator",
  Animator: "Animator",
  Continuity: "Continuity",
  SourceMaterial: "Source material",
  DirectorOfPhotography: "Director of photography",

  // activity superclasses that appear as credit roles in the data
  ProducingActivity: "Producing",
  DirectingActivity: "Directing",
  CinematographyActivity: "Cinematography",
  CastActivity: "Cast",
  MusicActivity: "Music",
  ProductionDesignActivity: "Production design",
  CopyrightandDistributionActivity: "Copyright and distribution",
  GafferLighting: "Gaffer / lighting",
  Distributor: "Distributor",
  MusicSupervisor: "Music supervisor",
  Lyricist: "Lyricist",
  Adaptation: "Adaptation",
  Broadcaster: "Broadcaster",
  Presenter: "Presenter",
  Interviewer: "Interviewer",
  Choreographer: "Choreographer",

  // forms
  FeatureFilm: "Feature film",
  ShortFilm: "Short film",
  DocumentaryFilm: "Documentary",
  AnimatedFilm: "Animated film",
  ExperimentalFilm: "Experimental film",
  AmateurFilm: "Amateur film",
  HomeMovie: "Home movie",
  Trailer: "Trailer",
  Newsreel: "Newsreel",
  TelevisionProgramme: "Television programme",
  TelevisionSeries: "Television series",
  Series: "Series",
  Serial: "Serial",
  Compilation: "Compilation",
  Fragment: "Fragment",
  ChildrensFilm: "Children's film",
  AnimationFilm: "Animated film",
  ComedyFilm: "Comedy",
  DramaFilm: "Drama",
  MusicFilm: "Music film",
  EducationalFilm: "Educational film",

  // genres
  Fiction: "Fiction",
  NonFiction: "Non-fiction",
  Documentary: "Documentary",
  News: "News",
  Sport: "Sport",
  Music: "Music",
  Educational: "Educational",
  Advertising: "Advertising",
  Animation: "Animation",
  Nature: "Nature",
  Travel: "Travel",
  Religion: "Religion",
  Politics: "Politics",
  History: "History",
  Comedy: "Comedy",
  Drama: "Drama",
  Horror: "Horror",
  Thriller: "Thriller",
  Western: "Western",
  Musical: "Musical",
  Crime: "Crime",
  ScienceFiction: "Science fiction",
  Erotic: "Erotic",
  Children: "Children",
  Family: "Family",

  // languages
  Norwegian: "Norwegian",
  English: "English",
  Swedish: "Swedish",
  Danish: "Danish",
  German: "German",
  French: "French",
  Spanish: "Spanish",
  Italian: "Italian",
  Russian: "Russian",
  Finnish: "Finnish",
  Sami: "Sami",
  NorthernSami: "Northern Sami",
  SouthernSami: "Southern Sami",
  NoDialogue: "No dialogue",

  // item status
  Access: "Access copy",
  Preservation: "Preservation copy",
  Master: "Master",
  ViewingCopy: "Viewing copy",
  ArchiveCopy: "Archive copy",
  LoanCopy: "Loan copy",

  // item element types
  OriginalNegative: "Original negative",
  DuplicateNegative: "Duplicate negative",
  SoundNegative: "Sound negative",
  ReleasePrint: "Release print",
  DuplicatePositive: "Duplicate positive",
  SoundPositive: "Sound positive",

  // countries
  Norway: "Norway",
  Sweden: "Sweden",
  Denmark: "Denmark",
  Finland: "Finland",
  Iceland: "Iceland",
  UnitedStates: "United States",
  UnitedKingdom: "United Kingdom",
  SovietUnion: "Soviet Union",
  CzechRepublic: "Czech Republic",
  NewZealand: "New Zealand",
  SouthAfrica: "South Africa",
  UnitedStatesOfAmerica: "United States",
  UnitedKingdomOfGreatBritainAndNorthernIreland: "United Kingdom",
  KoreaRepublicOf: "South Korea",
  KoreaDemocraticPeoplesRepublicOf: "North Korea",
  NetherlandsKingdomOf: "Netherlands",
  NetherlandsKingdomOf: "Netherlands",
  RussianFederation: "Russia",
  IranIslamicRepublicOf: "Iran",
  SyrianArabRepublic: "Syria",
  Turkiye: "Türkiye",
  VietNam: "Vietnam",
  TaiwanProvinceOfChina: "Taiwan",
  Czechia: "Czechia",
  HongKong: "Hong Kong",
  CongoDemocraticRepublicOfThe: "Democratic Republic of the Congo",

  // formats / carriers
  VHS: "VHS",
  Betacam: "Betacam",
  "BetacamSP": "Betacam SP",
  Umatic: "U-matic",
  UmaticSP: "U-matic SP",
  UmaticHighBand: "U-matic High Band",
  DVD: "DVD",
  BluRay: "Blu-ray",
  Film: "Film",
  "35mmFilm": "35mm film",
  "16mmFilm": "16mm film",
  "17.5mmFilm": "17.5mm film",
  Video: "Video",
  VideoFormat: "Video format",
  Digital: "Digital",
  DigitalFormat: "Digital format",
  DigitalBetacam: "Digital Betacam",
  DVCAM: "DVCAM",
  HDCAM: "HDCAM",
  HDCAMSR: "HDCAM SR",
  OneInchTypeC: "1-inch Type C",
  OneInchVideotape: "1-inch videotape",
  QuerterInchAudiotape: "1/4-inch audiotape",
  Betamax: "Betamax",
  OpticalDisc: "Optical disc",
  MagneticTape: "Magnetic tape"
};

// Local part of a FIAF IRI, or the input unchanged when it is not one.
export function localName(iri) {
  const text = String(iri || "");
  if (text.startsWith(FIAF_NS)) return text.slice(FIAF_NS.length).replace(/[/#]$/, "");
  const slash = text.lastIndexOf("/");
  const hash = text.lastIndexOf("#");
  const cut = Math.max(slash, hash);
  return cut >= 0 ? text.slice(cut + 1) : text;
}

const ACRONYMS = new Set([
  "TV", "NRK", "VHS", "DVD", "HD", "SD", "DTS", "UHF", "VHF", "CD", "LP",
  "SVT", "BBC", "USA", "UK", "SF", "AB", "DVCAM", "HDCAM", "HDCAM SR"
]);

// fiaf:FeatureFilm -> "Feature film"; fiaf:TVSeries -> "TV series".
export function humanize(iri) {
  const name = localName(iri);
  if (!name) return String(iri || "");
  if (LABELS[name]) return LABELS[name];
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([0-9]+)([A-Za-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word));
  if (!words.length) return name;
  const first = words[0];
  words[0] = ACRONYMS.has(first.toUpperCase())
    ? first.toUpperCase()
    : first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return words.join(" ");
}

export function roleLabel(iri) {
  return humanize(iri);
}

export function agentLabel(iri) {
  const name = localName(iri);
  return name || String(iri || "");
}
