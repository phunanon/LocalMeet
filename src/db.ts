import { appendFile, readFile } from 'fs/promises';

const file = 'users.csv';

export const addUser = async (snowflake: string, lat: number, lng: number) => {
  const ms = Date.now();
  await appendFile(file, `${snowflake},${lat},${lng},${ms}\n`);
};

export const userWhen = async (snowflake: string) => {
  const lines = (await readFile(file, 'utf-8')).split('\n');
  const line = lines.find(x => x.startsWith(snowflake));
  if (!line) return null;
  const [, , , ms] = line.split(',');
  return new Date(parseInt(ms ?? '0'));
};

export const searchDatabase = async (snowflake: string) => {
  const lines = (await readFile(file, 'utf-8')).split('\n').slice(0, -1);
  const userLocation = lines.find(x => x.startsWith(snowflake))?.split(',');
  if (!userLocation?.length) return;
  const [, lat, lng] = userLocation.map(parseFloat) as [number, number, number];
  const distances: {
    sf: string;
    distance: number;
    lat: number;
    lng: number;
  }[] = [];
  for (const line of lines) {
    const [sf, lat2Txt, lng2Txt] = line.split(',') as [string, string, string];
    if (sf === snowflake) continue;
    const lat2 = parseFloat(lat2Txt);
    const lng2 = parseFloat(lng2Txt);
    const distance = haversineDistance(lat, lng, lat2, lng2);
    distances.push({ sf, distance, lat: lat2, lng: lng2 });
  }
  distances.sort((a, b) => a.distance - b.distance);
  return distances;
};

const { sin, cos, atan2, sqrt, PI } = Math;

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRadians = (degree: number) => (degree * PI) / 180;
  const EarthRadiusKm = 6_371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    sin(dLat / 2) * sin(dLat / 2) +
    cos(lat1Rad) * cos(lat2Rad) * sin(dLon / 2) * sin(dLon / 2);
  const c = 2 * atan2(sqrt(a), sqrt(1 - a));

  const distance = EarthRadiusKm * c;
  return distance;
}
