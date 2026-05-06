export type RenderMode = "reference" | "zones";

export type Algorithm = "peaks" | "kmeans";

export type AnalyzeResult = {
  width: number;
  height: number;
  algo: Algorithm;
  n: number;
  palette: number[];
};
