declare module "*.png" {
  const imagePath: import("next/image").StaticImageData;
  export default imagePath;
}
