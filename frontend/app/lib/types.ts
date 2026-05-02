export type RenderMode = "reference" | "zones";

export type Algorithm = "peaks" | "kmeans";

export type IngestResult = {
  id: string;
  width: number;
  height: number;
};

export type AnalyzeResult = {
  width: number;
  height: number;
  algo: Algorithm;
  n: number;
  palette: number[];
  mapUrl: string;
  indexUrl: string;
};

export type AnalyzeParams = {
  algo: Algorithm;
  n: number;
  sigma: number;
};
