export type Kpi = { name: string; cadence?: string; target?: string; why?: string };
export type Skill = { name: string; why?: string; how_to_build?: string; proof?: string };
export type Snapshot = { year: number; scene?: string; wins?: string[]; costs?: string[]; fork?: string };
export type Path = {
  id?: string;
  name: string;
  thesis?: string;
  style?: string;
  tradeoff?: string;
  fit?: string;
  risk?: string;
  skills_kpi?: { skills?: Skill[]; kpis?: { leading?: Kpi[]; lagging?: Kpi[] }; "90_day_sprint"?: string[] };
  future?: { snapshots?: Snapshot[]; if_it_fails?: string; if_it_works?: string };
};
export type PlanDoc = { kgi?: string; horizon_years?: number; paths?: Path[] };
export type Payload = {
  kgi: FormDataEntryValue | null;
  context: FormDataEntryValue | null;
  n_paths: number;
  horizon_years: number;
  model: string | null;
  paths_doc?: PlanDoc;
};
