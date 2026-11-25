export type Instance = {
  id: number;
  role: "union" | "prefill" | "decode";
  endpoints: { id: number; address: string }[];
};
export type Connection = {
  id: string;
  name: string;
  model_name: string;
  inference_url: string;
  management_url: string;
  observability_url: string;
  controller_url: string;
  control_url: string;
  mode: "union" | "pd";
  expected_version: string;
  engine_version: string;
  verify_tls: boolean;
  timeout: number;
  revision: number;
  topology: Instance[];
  has_inference_key: boolean;
  has_management_key: boolean;
};
export type ConnectionDraft = Omit<Connection, "id" | "topology" | "has_inference_key" | "has_management_key"> & {
  inference_key?: string;
  management_key?: string;
  clear_inference_key: boolean;
  clear_management_key: boolean;
};
export type Status = {
  ready: boolean;
  message: string;
  checks: { name: string; state: string; elapsed_ms?: number; message?: string }[];
};
export type Metrics = {
  timestamp: number;
  running: number | null;
  waiting: number | null;
  input_tps: number | null;
  output_tps: number | null;
  cache_percent: number | null;
  requests_per_second: number | null;
  samples: { name: string; value: number; labels: Record<string, string> }[];
  message: string;
};
export const emptyDraft: ConnectionDraft = {
  name: "",
  model_name: "",
  inference_url: "http://motor:1025",
  management_url: "http://motor:1026",
  observability_url: "http://motor:1027",
  controller_url: "",
  control_url: "http://motor:1028",
  mode: "union",
  expected_version: "3.2.0",
  engine_version: "v0.30.0rc2",
  verify_tls: true,
  timeout: 10,
  revision: 0,
  clear_inference_key: false,
  clear_management_key: false,
};
export function toDraft(connection: Connection): ConnectionDraft {
  const {
    name,
    model_name,
    inference_url,
    management_url,
    observability_url,
    controller_url,
    control_url,
    mode,
    expected_version,
    engine_version,
    verify_tls,
    timeout,
    revision,
  } = connection;
  return {
    name,
    model_name,
    inference_url,
    management_url,
    observability_url,
    controller_url,
    control_url,
    mode,
    expected_version,
    engine_version,
    verify_tls,
    timeout,
    revision,
    clear_inference_key: false,
    clear_management_key: false,
  };
}
