export type RenderMode = "reference" | "zones";

export type Algorithm = "peaks" | "kmeans" | "otsu";

export type AnalyzeResult = {
  width: number;
  height: number;
  algo: Algorithm;
  n: number;
  palette: number[];
  boundaries: number[];
  zoneIndexPng: string;
  zoneMapPng: string;
};

export type AnalyzeParams = {
  algo: Algorithm;
  n: number;
  sigma: number;
};
