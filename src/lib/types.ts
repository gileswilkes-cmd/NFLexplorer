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

// --- teams (Phase 3) ---

export interface EffBlock {
  epa_per_play?: number;
  success_rate?: number;
  epa_per_play_allowed?: number;
  success_rate_allowed?: number;
  plays_per_game?: number;
  plays?: number;
  games?: number;
}

/** down×distance cell; empty cells have plays: 0 and no EPA keys */
export type DDCell = EffBlock & { plays: number };

export interface TeamSeason {
  season: number;
  code: string;
  games: number;
  record: { w: number; l: number; t: number } | null;
  offense: {
    summary: Record<string, number>;
    by_play_type: { pass: EffBlock; rush: EffBlock };
    fingerprint: {
      proe: number | null;
      early_down_pass_rate: number | null;
      neutral_pace_sec: number | null;
      shotgun_rate: number | null;
      adot: number | null;
      run_dir: { left: number; middle: number; right: number } | null;
      run_dir_known: number | null;
    };
    scheme_splits: {
      shotgun_vs_under_center: { shotgun: EffBlock; under_center: EffBlock };
      early_down_pass_vs_run: { pass: EffBlock; rush: EffBlock };
      pass_heavy_vs_balanced: { pass_heavy: EffBlock; balanced: EffBlock };
      deep_shots: EffBlock & { rate: number | null; attempts: number };
    };
    down_distance: Record<string, DDCell>;
  };
  defense: {
    summary: Record<string, number>;
    by_play_type: { pass: EffBlock; rush: EffBlock };
    explosive_rate_allowed: number | null;
    sack_rate: number | null;
    down_distance: Record<string, DDCell>;
  };
  percentiles: { offense: Record<string, number>; defense: Record<string, number> };
}

export interface TeamDoc {
  schema_version: number;
  franchise: string;
  name: string;
  colors: { primary: string; secondary: string } | null;
  seasons: TeamSeason[];
}

export interface TeamIndexEntry {
  franchise: string;
  name: string;
  colors: { primary: string; secondary: string } | null;
  latest: { season: number; record: { w: number; l: number; t: number } | null };
}

export interface TeamIndex {
  schema_version: number;
  teams: TeamIndexEntry[];
}
