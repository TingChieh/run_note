type ActivityFeature = { properties: { activity_id?: string | null } };

export function colorFootprintFeatures<T extends ActivityFeature>(features: T[], palette: readonly string[]) {
  const colors = new Map<string | null | undefined, string>();
  let nextColor = 0;
  return features.map((feature) => {
    const id = feature.properties.activity_id;
    let color = colors.get(id);
    if (color === undefined) {
      color = palette[nextColor++ % palette.length];
      colors.set(id, color);
    }
    return { ...feature, properties: { ...feature.properties, color } };
  });
}
