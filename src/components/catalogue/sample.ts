// The sample catalogue, bundled with the page so it works on the deployed site. The photos and the CSV are the
// files in demo-assets/catalogue; the spare photo folder is not bundled.
import sampleCsv from '../../../demo-assets/catalogue/catalogue.csv?raw';

const photoUrls = import.meta.glob<string>('../../../demo-assets/catalogue/*.jpg', { eager: true, query: '?url', import: 'default' });

export const SAMPLE_CSV = sampleCsv;

/** File name to bundled photo address. */
export const SAMPLE_PHOTOS: Record<string, string> = Object.fromEntries(
  Object.entries(photoUrls).map(([path, url]) => [path.split('/').pop() as string, url]),
);
