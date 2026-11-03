/** High-contrast data colors, shared by the map, legend and ranking. */
const palette = [
  '#d13b42', '#007eaa', '#9a5ac7', '#a26700',
  '#008474', '#cf4c8a', '#526ac7', '#788000',
  '#c05419', '#00828c', '#a54477', '#5d72a0',
  '#487c3c', '#b15b58', '#6f609b', '#827043'
];

type Participant = { user_id: string; username: string };

export function participantColors(participants: Participant[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = Object.create(null);
  // Sort by ID so an API ordering change does not change collision resolution.
  for (const person of [...participants].sort((a, b) => a.user_id.localeCompare(b.user_id))) {
    let hash = 2166136261;
    for (const char of person.user_id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    let index = (hash >>> 0) % palette.length;
    while (used.has(palette[index]) && used.size < palette.length) index = (index + 1) % palette.length;
    let color = palette[index];
    if (used.size >= palette.length) {
      // Beyond the fixed palette, generate distinct, repeatable colors without a hard participant limit.
      let extra = used.size - palette.length;
      do { color = `hsl(${(extra++ * 137.508) % 360} 72% 46%)`; } while (used.has(color));
    }
    used.add(color);
    result[person.username] = color;
  }
  return result;
}
