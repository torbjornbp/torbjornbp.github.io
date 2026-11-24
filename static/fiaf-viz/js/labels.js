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
  EditingActivity: "Editing",
  WritingActivity: "Writing",
  SpecialEffectsActivity: "Special effects",
  AnimationActivity: "Animation",
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

  // title types (fiaf:Title subclasses). The ontology spells one class
  // "IdentifiyingTitle"; the IRI stays as the data has it, the label does not.
  IdentifiyingTitle: "Identifying title",
  TitleProper: "Title proper",
  PreferredTitle: "Preferred title",
  ParallelTitle: "Parallel title",
  AlternativeTitle: "Alternative title",
  TranslatedTitle: "Translated title",
  TransliteratedTitle: "Transliterated title",
  AbbreviatedTitle: "Abbreviated title",
  CorrectedTitle: "Corrected title",
  WorkingTitle: "Working title",
  "Pre-ReleaseTitle": "Pre-release title",
  AcquisitionTitle: "Acquisition title",
  SuppliedDevisedTitle: "Supplied/devised title",
  SeriesTitle: "Series title",
  SearchTitle: "Search title",

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

// Display order for title types in the work drawer: the titles that name the
// work first, then variants, then the cataloguing aids. A class not listed
// here (new upstream) sorts after the listed ones; untyped fiaf:Title is last.
const TITLE_TYPE_ORDER = [
  "IdentifiyingTitle", "TitleProper", "PreferredTitle", "ParallelTitle",
  "AlternativeTitle", "TranslatedTitle", "TransliteratedTitle",
  "AbbreviatedTitle", "CorrectedTitle", "WorkingTitle", "Pre-ReleaseTitle",
  "AcquisitionTitle", "SuppliedDevisedTitle", "SeriesTitle", "SearchTitle"
];

function titleTypeRank(type) {
  if (type === "Title") return TITLE_TYPE_ORDER.length + 1;
  const index = TITLE_TYPE_ORDER.indexOf(type);
  return index >= 0 ? index : TITLE_TYPE_ORDER.length;
}

// "IdentifiyingTitle~Metropolis|AlternativeTitle~Metropol" (from
// work-metadata.rq) -> [{ type, label, values }], one group per title type in
// TITLE_TYPE_ORDER, values alphabetical. A part without "~" counts as untyped.
// An untyped value that also has a real type (a title carrying a non-FIAF
// class as well) is shown only under that type.
export function titleGroups(value) {
  if (value === undefined || value === null || value === "") return [];
  const groups = new Map();
  for (const raw of String(value).split("|")) {
    const part = raw.trim();
    if (!part) continue;
    const cut = part.indexOf("~");
    const type = (cut >= 0 ? part.slice(0, cut) : "") || "Title";
    const text = (cut >= 0 ? part.slice(cut + 1) : part).trim();
    if (!text) continue;
    if (!groups.has(type)) groups.set(type, new Set());
    groups.get(type).add(text);
  }
  const untyped = groups.get("Title");
  if (untyped) {
    for (const [type, values] of groups) {
      if (type !== "Title") for (const text of values) untyped.delete(text);
    }
    if (!untyped.size) groups.delete("Title");
  }
  return [...groups]
    .map(([type, values]) => ({
      type,
      label: type === "Title" ? "Untyped title" : humanize(type),
      values: [...values].sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) =>
      titleTypeRank(a.type) - titleTypeRank(b.type) || a.label.localeCompare(b.label));
}

// Heading for a manifestation in the holdings tree, info box and record graph:
// its type, then its formats. Manifestations carry no rdfs:label in the
// public graph, and titles exist only for some datasets, so type and format
// are what most records have. The identifier goes in the meta line instead.
// ("…/TheatricalManifestation", ["…/35mmFilm"]) -> "Theatrical Manifestation · 35mm film"
export function manifestationHeading(type, formats = []) {
  const parts = [type ? humanize(type) : "Manifestation"];
  const formatText = formats.filter(Boolean).map(humanize).join(", ");
  if (formatText) parts.push(formatText);
  return parts.join(" · ");
}

const EXTENT_UNITS = { Metre: "m", Minute: "min", Foot: "ft", Second: "s" };

// "Metre~1991" (from work-holdings.rq) -> "1,991 m"; "Minute~92" -> "92 min".
// An unknown unit is humanized; a non-numeric amount is shown as given.
export function extentText(value) {
  const text = String(value || "");
  const cut = text.indexOf("~");
  const unit = cut >= 0 ? text.slice(0, cut) : "";
  const amount = (cut >= 0 ? text.slice(cut + 1) : text).trim();
  if (!amount) return "";
  const number = Number(amount);
  const shown = amount !== "" && Number.isFinite(number)
    ? number.toLocaleString("en-GB", { maximumFractionDigits: 2 })
    : amount;
  if (!unit) return shown;
  return `${shown} ${EXTENT_UNITS[unit] || humanize(unit).toLowerCase()}`;
}

// Title rows from entity-properties.rq (property, valueTitle, valueType; a
// title with two classes comes back once per class) -> titleGroups(). A class
// outside FIAF counts as untyped, as in work-metadata.rq.
export function entityTitleGroups(properties) {
  const parts = [];
  for (const row of properties || []) {
    if (row.property !== `${FIAF_NS}hasTitle` || !row.valueTitle) continue;
    const type = String(row.valueType || "").startsWith(FIAF_NS)
      ? localName(row.valueType)
      : "Title";
    parts.push(`${type}~${String(row.valueTitle).replace(/\|/g, "/")}`);
  }
  return titleGroups(parts.join("|"));
}
