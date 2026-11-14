import { GedcomIndividual, PendingEdit, PendingEditType } from '@/types/genealogy';

export const PENDING_EDIT_TYPE_LABELS: Record<PendingEditType | string, string> = {
  update_person: 'Edit Person',
  add_person: 'Add Person',
  add_child: 'Add Child',
  add_spouse: 'Add Spouse',
  link_spouses: 'Link Spouses',
  edit_marriage: 'Edit Marriage',
  link_child: 'Link Child',
  edit_parent: 'Edit Parent',
  remove_child: 'Remove Child',
  unlink_spouses: 'Unlink Spouses',
  delete_person: 'Delete Person',
  merge_people: 'Merge People',
};

export function pendingEditTypeLabel(editType: string): string {
  return PENDING_EDIT_TYPE_LABELS[editType] ?? editType.replace(/_/g, ' ');
}

/** One-line summary of what was submitted — works offline from payload alone. */
export function pendingEditSummary(edit: Pick<PendingEdit, 'edit_type' | 'target_id' | 'data'>): string {
  const data = (edit.data ?? {}) as Record<string, unknown>;

  if (edit.edit_type === 'update_person') {
    return (data.individual as GedcomIndividual | undefined)?.name ?? edit.target_id;
  }
  if (edit.edit_type === 'add_person') {
    return (data.individual as GedcomIndividual | undefined)?.name ?? 'New person';
  }
  if (edit.edit_type === 'add_child') {
    const child = data.child as GedcomIndividual | undefined;
    const parent = data.parentName as string | undefined;
    if (child?.name && parent) return `${child.name} → child of ${parent}`;
    return child?.name ?? 'New child';
  }
  if (edit.edit_type === 'add_spouse') {
    const spouse = data.spouse as GedcomIndividual | undefined;
    const target = data.personName as string | undefined;
    if (spouse?.name && target) return `${spouse.name} → spouse of ${target}`;
    return spouse?.name ?? 'New spouse';
  }
  if (edit.edit_type === 'link_spouses' || edit.edit_type === 'edit_marriage' || edit.edit_type === 'unlink_spouses') {
    const p1 = data.person1Name as string | undefined;
    const p2 = data.person2Name as string | undefined;
    if (p1 && p2) return `${p1} & ${p2}`;
    if (edit.edit_type === 'edit_marriage') return 'Edit marriage';
    if (edit.edit_type === 'unlink_spouses') return 'Unlink spouses';
    return 'Link spouses';
  }
  if (edit.edit_type === 'link_child') {
    const child = data.childName as string | undefined;
    const parent = data.parentName as string | undefined;
    if (child && parent) return `${child} → child of ${parent}`;
    return child || 'Link child';
  }
  if (edit.edit_type === 'remove_child') {
    return (data.childName as string) || 'Remove child link';
  }
  if (edit.edit_type === 'edit_parent') {
    return (data.childName as string) || 'Edit parent';
  }
  if (edit.edit_type === 'delete_person') {
    const person = data.person as GedcomIndividual | undefined;
    return person?.name || (data.personId as string) || edit.target_id;
  }
  if (edit.edit_type === 'merge_people') {
    const keep = (data.keepName as string) || (data.keepPerson as GedcomIndividual | undefined)?.name;
    const merge = (data.mergeName as string) || (data.mergePerson as GedcomIndividual | undefined)?.name;
    return keep && merge ? `${merge} → ${keep}` : 'Merge people';
  }
  return edit.target_id;
}
