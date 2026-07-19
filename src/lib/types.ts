// TypeScript mirror of docs/DATA_SCHEMA.md (schema v1)

export type StatMap = Record<string, number>;

export interface NgsBlock {
  [key: string]: number;
}

export interface AdvancedBlock {
  epa_per_play?: number;
  cpoe?: number;
  adot?: number;
  yac_oe?: number;
  n_plays?: number;
  n_att?: number;
  /** null = not published for that season (pre-2016, or below NGS minimums) */
  ngs?: NgsBlock | null;
}

export interface SeasonRow {
  season: number;
  team: string | null;
  teams: string[];
  pos: string | null;
  games: number;
  game_type: "REG" | "POST";
  stats: StatMap;
  advanced?: AdvancedBlock;
  percentiles: Record<string, number>;
}

export interface CareerBlock {
  games: number;
  stats: StatMap;
  advanced?: AdvancedBlock;
}

export interface GameLog {
  season: number;
  week: number;
  game_type: string;
  date: string | null;
  team: string | null;
  opp: string | null;
  home: boolean | null;
  stats: StatMap;
}

export interface PlayerDoc {
  schema_version: number;
  id: string;
  profile: {
    name: string;
    pos: string;
    dob: string | null;
    height_in: number | null;
    weight_lb: number | null;
    college: string | null;
    draft: { year: number; round: number; pick: number; team: string } | null;
    headshot: string | null;
    teams: string[];
  };
  seasons: SeasonRow[];
  career?: CareerBlock;
  career_post?: CareerBlock;
  game_logs: GameLog[];
}

export interface IndexEntry {
  id: string;
  name: string;
  pos: string | null;
  team: string | null;
  first_season: number;
  last_season: number;
  active: boolean;
  headshot: string | null;
}

export interface PlayerIndex {
  schema_version: number;
  players: IndexEntry[];
}
