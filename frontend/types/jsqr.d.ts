declare module "jsqr" {
  interface QRPoint {
    x: number;
    y: number;
  }

  interface QRCode {
    binaryData: number[];
    data: string;
    chunks: unknown[];
    location: {
      topRightCorner: QRPoint;
      topLeftCorner: QRPoint;
      bottomRightCorner: QRPoint;
      bottomLeftCorner: QRPoint;
      topRightFinderPattern: QRPoint;
      topLeftFinderPattern: QRPoint;
      bottomLeftFinderPattern: QRPoint;
    };
  }

  interface Options {
    inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst";
  }

  function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: Options
  ): QRCode | null;

  export default jsQR;
}
