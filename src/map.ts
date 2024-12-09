import { make, encodePNGToStream, decodePNGFromStream } from 'pureimage';
import { createReadStream, createWriteStream } from 'fs';

const width = 3100;
const height = 1600;

export const RenderMap = async (
  coords: { lat: number; lng: number; inactive: boolean }[],
) => {
  const canvas = make(width, height);
  const ctx = canvas.getContext('2d');

  const mapImageStream = createReadStream('Robinson.png');
  const map = await decodePNGFromStream(mapImageStream);

  ctx.drawImage(map, 0, 0, map.width, map.height, 0, 0, width, height);

  for (const { lat, lng, inactive } of coords) {
    const { x, y } = latLngToRobinson(lat, lng, width, height);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = inactive ? 'rgba(255, 0, 0, 0.25)' : 'rgba(0, 200, 0, 0.5)';
    ctx.fill();
  }

  const path = `map.png`;
  await encodePNGToStream(canvas, createWriteStream(path));

  return { path };
};

function latLngToRobinson(
  lat: number,
  lng: number,
  width: number,
  height: number,
): { x: number; y: number } {
  // Robinson projection constants
  const robinsonCoeffs = [
    { x: 1, y: 0 },
    { x: 0.9986, y: 0.062 },
    { x: 0.9954, y: 0.124 },
    { x: 0.99, y: 0.186 },
    { x: 0.9822, y: 0.248 },
    { x: 0.973, y: 0.31 },
    { x: 0.96, y: 0.372 },
    { x: 0.9427, y: 0.434 },
    { x: 0.9216, y: 0.4958 },
    { x: 0.8962, y: 0.5571 },
    { x: 0.8679, y: 0.6176 },
    { x: 0.835, y: 0.6769 },
    { x: 0.7986, y: 0.7346 },
    { x: 0.7597, y: 0.7903 },
    { x: 0.7186, y: 0.8435 },
    { x: 0.6732, y: 0.8936 },
    { x: 0.6213, y: 0.9394 },
    { x: 0.5722, y: 0.9761 },
    { x: 0.5322, y: 1.0 },
  ];

  // Clamp latitude between -90 and 90 degrees
  lat = Math.max(-90, Math.min(90, lat));

  // Shift the longitude by 10 degrees (for 10E projection)
  lng = lng - 10; // Shift longitude by 10 degrees

  // Normalize longitude to -180 to 180 degrees
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;

  // Calculate latitude index and fractional part
  const absLat = Math.abs(lat);
  const latIndex = Math.floor(absLat / 5);
  const latFraction = (absLat % 5) / 5;

  // Interpolate coefficients
  const interp = (a: number, b: number, f: number) => a + (b - a) * f;
  const coeffA = robinsonCoeffs[latIndex]!;
  const coeffB =
    robinsonCoeffs[Math.min(latIndex + 1, robinsonCoeffs.length - 1)]!;
  const xCoeff = interp(coeffA.x, coeffB.x, latFraction);
  const yCoeff = interp(coeffA.y, coeffB.y, latFraction);

  // Calculate x and y coordinates
  const x = (lng / 180) * (width / 2) * xCoeff + width / 2;
  const y = height / 2 - Math.sign(lat) * yCoeff * (height / 2);

  return { x, y };
}
