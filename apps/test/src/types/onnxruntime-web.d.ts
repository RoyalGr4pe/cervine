// onnxruntime-web 1.21 ships a types.d.ts at its package root but omits a
// "types" condition from its exports map, so moduleResolution: "bundler"
// can't resolve them. Shim: declare the module and forward types to
// onnxruntime-common (pinned as a direct devDep for stable resolution).

declare module "onnxruntime-web" {
  export * from "onnxruntime-common";
}
