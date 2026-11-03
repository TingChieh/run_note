/** High-contrast data colors, shared by the map, legend and ranking. */
const palette = [
  '#b15b58', '#6f609b', '#d13b42', '#487c3c',
  '#cf4c8a', '#5d72a0', '#a54477', '#007eaa',
  '#827043', '#526ac7', '#788000', '#00828c',
  '#a26700', '#9a5ac7', '#c05419', '#008474'
];

type Participant = { user_id: string; username: string };

export function participantColors(participants: Participant[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = Object.create(null);
  // Sort by ID so an API ordering change does not change collision resolution.
  for (const person of [...participants].sort((a, b) => a.user_id.localeCompare(b.user_id))) {
    if (used.size === palette.length) used.clear();
    let hash = 2166136261;
    for (const char of person.user_id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    let index = (hash >>> 0) % palette.length;
    while (used.has(palette[index]) && used.size < palette.length) index = (index + 1) % palette.length;
    const color = palette[index];
    used.add(color);
    result[person.username] = color;
  }
  return result;
}
