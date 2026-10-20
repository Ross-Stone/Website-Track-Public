// /settings/* (FR-SET-01). Writers and Admin see tracking settings; Admin also family settings;
// Read only users see Theme and About only.
import { ActivityTypeEditor, ActivityTypes, FieldEditor } from './ActivityTypes';
import { ChildActivities, Children, Medicines, Users } from './Family';
import { SettingsIndex } from './SettingsIndex';
import { ScheduleEditor, ScheduleList } from './Schedule';

export function SettingsRouter({ path }: { path: string }) {
  const parts = path.split('/').filter(Boolean).slice(1); // after "settings"
  const [section, id, sub, subId] = parts;
  switch (section) {
    case undefined:
      return <SettingsIndex />;
    case 'schedule':
      return id ? <ScheduleEditor key={id} id={id} /> : <ScheduleList />;
    case 'types':
      if (id && sub === 'fields')
        return <FieldEditor key={`${id}:${subId}`} typeId={id} fieldId={subId ?? 'new'} />;
      return id ? <ActivityTypeEditor key={id} id={id} /> : <ActivityTypes />;
    case 'child-activities':
      return <ChildActivities />;
    case 'medicines':
      return <Medicines />;
    case 'children':
      return <Children />;
    case 'users':
      return <Users />;
    default:
      return <SettingsIndex />;
  }
}
