// Pure ordering helper lifted from the retired in-builder template banner
// (#571). Floats Estimate templates whose damage_type_tags include the Job's
// damage type to the top of the picker, keeping every other template in its
// original relative position. A stable partition — no sorting.

export function pinTemplatesByDamageType<
  T extends { damage_type_tags: string[] },
>(templates: T[], jobDamageType: string | null): T[] {
  if (!jobDamageType) return templates;

  const pinned: T[] = [];
  const rest: T[] = [];
  for (const t of templates) {
    if (Array.isArray(t.damage_type_tags) && t.damage_type_tags.includes(jobDamageType)) {
      pinned.push(t);
    } else {
      rest.push(t);
    }
  }
  return [...pinned, ...rest];
}
