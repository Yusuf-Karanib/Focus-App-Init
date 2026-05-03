import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  ListRenderItemInfo,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FocusModule, InstalledApp } from "../modules/focus-module";
import {
  DAY_LABELS,
  FocusProfile,
  FocusSchedule,
  formatTime,
  isProfileActive,
  makeProfileId,
  parseTime,
  useFocusProfiles,
} from "../lib/profiles";

/* ── Tokens (mirrored from the home screen for visual consistency) ────── */

const BG = "#000000";
const FG = "#ffffff";
const DIM = "#666666";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

/* ── Defaults ──────────────────────────────────────────────────────────── */

/**
 * Schedule applied when the user taps "[ ADD SCHEDULE ]" on a profile that
 * was previously always-on. 9:00–17:00, weekdays — the canonical "work
 * hours" example from the prompt. The user can edit any of these
 * immediately; the defaults just have to be sensible enough that the
 * profile is functional out of the box.
 */
const DEFAULT_SCHEDULE: FocusSchedule = {
  enabled: true,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  days: [1, 2, 3, 4, 5], // Mon–Fri
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function makeBlankProfile(): FocusProfile {
  return {
    id: makeProfileId(),
    name: "",
    blockedApps: [],
    schedule: null,
  };
}

/** Deep-clone a profile so the editor can mutate freely without aliasing. */
function cloneProfile(p: FocusProfile): FocusProfile {
  return {
    id: p.id,
    name: p.name,
    blockedApps: [...p.blockedApps],
    schedule: p.schedule
      ? { ...p.schedule, days: [...p.schedule.days] }
      : null,
  };
}

function lightHaptic() {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

/* ── Screen ────────────────────────────────────────────────────────────── */

export default function ProfilesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = insets.top;

  const { profiles, loaded, setProfiles } = useFocusProfiles();

  // Installed apps — loaded once for the app-picker modal. The launcher
  // already calls this on its own mount; calling it again here is cheap
  // and keeps this screen self-contained.
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  useEffect(() => {
    try {
      setInstalledApps(FocusModule.getInstalledApps());
    } catch {
      setInstalledApps([]);
    }
  }, []);

  // Editor state. `draft === null` means the editor is closed.
  const [draft, setDraft] = useState<FocusProfile | null>(null);
  const [draftIsNew, setDraftIsNew] = useState<boolean>(false);

  // Time inputs are decoupled from the schedule so the user can type
  // partial input ("9", "09:") without the parsed-back display fighting
  // their cursor. We push valid values back into the schedule on blur.
  const [startInput, setStartInput] = useState<string>("09:00");
  const [endInput, setEndInput] = useState<string>("17:00");

  const [pickingApps, setPickingApps] = useState<boolean>(false);

  /* ── List handlers ──────────────────────────────────────────────────── */

  const openEditor = useCallback((profile: FocusProfile, isNew: boolean) => {
    lightHaptic();
    const cloned = cloneProfile(profile);
    setDraft(cloned);
    setDraftIsNew(isNew);
    if (cloned.schedule) {
      setStartInput(formatTime(cloned.schedule.startMinute));
      setEndInput(formatTime(cloned.schedule.endMinute));
    } else {
      setStartInput(formatTime(DEFAULT_SCHEDULE.startMinute));
      setEndInput(formatTime(DEFAULT_SCHEDULE.endMinute));
    }
  }, []);

  const handleNewProfile = useCallback(() => {
    openEditor(makeBlankProfile(), true);
  }, [openEditor]);

  const closeEditor = useCallback(() => {
    setDraft(null);
    setDraftIsNew(false);
    setPickingApps(false);
  }, []);

  /* ── Editor mutators ────────────────────────────────────────────────── */

  // Every editor field uses this functional updater so we never read a
  // stale draft from a closure. Returning `null` from the producer is a
  // no-op (defensive against keypresses arriving after close).
  const updateDraft = useCallback(
    (producer: (d: FocusProfile) => FocusProfile) => {
      setDraft((current) => (current ? producer(current) : current));
    },
    []
  );

  const handleNameChange = useCallback(
    (name: string) => updateDraft((d) => ({ ...d, name })),
    [updateDraft]
  );

  const toggleScheduleExists = useCallback(() => {
    lightHaptic();
    updateDraft((d) =>
      d.schedule
        ? { ...d, schedule: null }
        : { ...d, schedule: { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] } }
    );
    // Reset the time inputs to whatever the schedule (or default) now shows.
    setStartInput(formatTime(DEFAULT_SCHEDULE.startMinute));
    setEndInput(formatTime(DEFAULT_SCHEDULE.endMinute));
  }, [updateDraft]);

  const toggleScheduleEnabled = useCallback(() => {
    lightHaptic();
    updateDraft((d) =>
      d.schedule
        ? { ...d, schedule: { ...d.schedule, enabled: !d.schedule.enabled } }
        : d
    );
  }, [updateDraft]);

  const toggleDay = useCallback(
    (day: number) => {
      lightHaptic();
      updateDraft((d) => {
        if (!d.schedule) return d;
        const has = d.schedule.days.includes(day);
        const days = has
          ? d.schedule.days.filter((x) => x !== day)
          : [...d.schedule.days, day].sort((a, b) => a - b);
        return { ...d, schedule: { ...d.schedule, days } };
      });
    },
    [updateDraft]
  );

  // Time input commit handlers: parse on blur and either keep the parsed
  // minute count or revert the display to the last valid value. We never
  // mutate the schedule mid-typing — that would fight the user's cursor.
  const commitStart = useCallback(() => {
    const minute = parseTime(startInput);
    if (minute == null) {
      // Revert display to the underlying value
      const fallback = draft?.schedule?.startMinute ?? DEFAULT_SCHEDULE.startMinute;
      setStartInput(formatTime(fallback));
      return;
    }
    setStartInput(formatTime(minute));
    updateDraft((d) =>
      d.schedule ? { ...d, schedule: { ...d.schedule, startMinute: minute } } : d
    );
  }, [startInput, draft, updateDraft]);

  const commitEnd = useCallback(() => {
    const minute = parseTime(endInput);
    if (minute == null) {
      const fallback = draft?.schedule?.endMinute ?? DEFAULT_SCHEDULE.endMinute;
      setEndInput(formatTime(fallback));
      return;
    }
    setEndInput(formatTime(minute));
    updateDraft((d) =>
      d.schedule ? { ...d, schedule: { ...d.schedule, endMinute: minute } } : d
    );
  }, [endInput, draft, updateDraft]);

  /* ── Save / delete / cancel ─────────────────────────────────────────── */

  const handleSave = useCallback(async () => {
    if (!draft) return;
    // Force a final commit of the time inputs in case the user tapped SAVE
    // while a TextInput still had focus. We re-parse from the current input
    // strings rather than reading the draft, since blur may not have fired.
    let finalDraft = draft;
    if (finalDraft.schedule) {
      const s = parseTime(startInput);
      const e = parseTime(endInput);
      finalDraft = {
        ...finalDraft,
        schedule: {
          ...finalDraft.schedule,
          startMinute: s ?? finalDraft.schedule.startMinute,
          endMinute: e ?? finalDraft.schedule.endMinute,
        },
      };
    }

    // Trim and default the name. An empty-named profile is still legal —
    // it just shows up as "(UNNAMED)" in the list — but we trim trailing
    // whitespace because that's almost certainly accidental.
    finalDraft = { ...finalDraft, name: finalDraft.name.trim() };

    const next = draftIsNew
      ? [...profiles, finalDraft]
      : profiles.map((p) => (p.id === finalDraft.id ? finalDraft : p));

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    await setProfiles(next);
    closeEditor();
  }, [draft, draftIsNew, profiles, setProfiles, startInput, endInput, closeEditor]);

  const handleDelete = useCallback(async () => {
    if (!draft || draftIsNew) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    await setProfiles(profiles.filter((p) => p.id !== draft.id));
    closeEditor();
  }, [draft, draftIsNew, profiles, setProfiles, closeEditor]);

  /* ── App picker ─────────────────────────────────────────────────────── */

  const sortedInstalledApps = useMemo(() => {
    return [...installedApps].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  }, [installedApps]);

  const togglePackageInDraft = useCallback(
    (pkg: string) => {
      lightHaptic();
      updateDraft((d) => {
        const has = d.blockedApps.includes(pkg);
        return {
          ...d,
          blockedApps: has
            ? d.blockedApps.filter((p) => p !== pkg)
            : [...d.blockedApps, pkg],
        };
      });
    },
    [updateDraft]
  );

  /* ── Render: list view ──────────────────────────────────────────────── */

  const renderProfileRow = useCallback(
    ({ item }: ListRenderItemInfo<FocusProfile>) => {
      const active = isProfileActive(item, new Date());
      const scheduleSummary = describeSchedule(item.schedule);
      const appCountLabel =
        item.blockedApps.length === 1
          ? "1 APP"
          : `${item.blockedApps.length} APPS`;
      return (
        <Pressable
          onPress={() => openEditor(item, false)}
          accessibilityRole="button"
          accessibilityLabel={`Edit profile ${item.name || "unnamed"}`}
        >
          {({ pressed }) => (
            <View style={[styles.profileRow, pressed && styles.profileRowPressed]}>
              <View style={styles.profileRowHead}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {(item.name.trim() || "(UNNAMED)").toUpperCase()}
                </Text>
                <Text style={active ? styles.statusActive : styles.statusIdle}>
                  {active ? "[ ACTIVE ]" : "[ IDLE ]"}
                </Text>
              </View>
              <Text style={styles.profileMeta}>
                {appCountLabel}  ·  {scheduleSummary}
              </Text>
            </View>
          )}
        </Pressable>
      );
    },
    [openEditor]
  );

  const ListHeader = (
    <View style={{ paddingHorizontal: 20 }}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to launcher"
        >
          {({ pressed }) => (
            <Text style={[styles.headerLink, pressed && styles.headerLinkPressed]}>
              {"[ ← BACK ]"}
            </Text>
          )}
        </Pressable>
        <Text style={styles.appName}>PROFILES</Text>
        <View style={styles.headerLinkSpacer} />
      </View>
      <View style={styles.divider} />
      <Text style={styles.intro}>
        PROFILES BUNDLE BLOCKED APPS WITH AN OPTIONAL SCHEDULE.{"\n"}
        ALL ACTIVE PROFILES BLOCK SIMULTANEOUSLY.
      </Text>
      <View style={styles.divider} />
    </View>
  );

  const ListFooter = (
    <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
      <Pressable
        onPress={handleNewProfile}
        accessibilityRole="button"
        accessibilityLabel="Create a new profile"
      >
        {({ pressed }) => (
          <Text style={[styles.bigAction, pressed && styles.bigActionPressed]}>
            [ + NEW PROFILE ]
          </Text>
        )}
      </Pressable>
    </View>
  );

  // Empty state — only show after the initial load resolves, otherwise
  // it flashes on every cold start.
  const ListEmpty = loaded ? (
    <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
      <Text style={styles.emptyText}>
        NO PROFILES YET.{"\n"}
        TAP [ + NEW PROFILE ] BELOW.
      </Text>
    </View>
  ) : null;

  return (
    <View style={[styles.root, { paddingTop: topPad + 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={profiles}
        renderItem={renderProfileRow}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* ── Editor modal ────────────────────────────────────────────── */}
      <Modal
        visible={draft !== null}
        transparent={false}
        animationType="none"
        onRequestClose={closeEditor}
        statusBarTranslucent
      >
        {draft && (
          <EditorView
            draft={draft}
            isNew={draftIsNew}
            startInput={startInput}
            endInput={endInput}
            onChangeName={handleNameChange}
            onToggleScheduleExists={toggleScheduleExists}
            onToggleScheduleEnabled={toggleScheduleEnabled}
            onChangeStart={setStartInput}
            onChangeEnd={setEndInput}
            onCommitStart={commitStart}
            onCommitEnd={commitEnd}
            onToggleDay={toggleDay}
            onOpenAppPicker={() => setPickingApps(true)}
            onSave={handleSave}
            onCancel={closeEditor}
            onDelete={handleDelete}
            topPad={topPad}
          />
        )}
      </Modal>

      {/* ── App picker modal ────────────────────────────────────────── */}
      <Modal
        visible={pickingApps}
        transparent={false}
        animationType="none"
        onRequestClose={() => setPickingApps(false)}
        statusBarTranslucent
      >
        {draft && (
          <AppPickerView
            apps={sortedInstalledApps}
            selected={new Set(draft.blockedApps)}
            onToggle={togglePackageInDraft}
            onClose={() => setPickingApps(false)}
            topPad={topPad}
          />
        )}
      </Modal>
    </View>
  );
}

/* ── Editor view (inside the editor modal) ─────────────────────────────── */

interface EditorViewProps {
  draft: FocusProfile;
  isNew: boolean;
  startInput: string;
  endInput: string;
  onChangeName: (name: string) => void;
  onToggleScheduleExists: () => void;
  onToggleScheduleEnabled: () => void;
  onChangeStart: (s: string) => void;
  onChangeEnd: (s: string) => void;
  onCommitStart: () => void;
  onCommitEnd: () => void;
  onToggleDay: (day: number) => void;
  onOpenAppPicker: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  topPad: number;
}

function EditorView(props: EditorViewProps) {
  const { draft } = props;
  const schedule = draft.schedule;

  return (
    <View style={[styles.modalRoot, { paddingTop: props.topPad + 24 }]}>
      <View style={styles.modalInner}>
        <View style={styles.headerRow}>
          <Pressable onPress={props.onCancel} accessibilityRole="button">
            {({ pressed }) => (
              <Text
                style={[styles.headerLink, pressed && styles.headerLinkPressed]}
              >
                {"[ CANCEL ]"}
              </Text>
            )}
          </Pressable>
          <Text style={styles.appName}>
            {props.isNew ? "NEW PROFILE" : "EDIT PROFILE"}
          </Text>
          <View style={styles.headerLinkSpacer} />
        </View>
        <View style={styles.divider} />

        {/* NAME */}
        <Text style={styles.fieldLabel}>NAME</Text>
        <TextInput
          value={draft.name}
          onChangeText={props.onChangeName}
          placeholder="E.G. WORK"
          placeholderTextColor={DIM}
          style={styles.textField}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
        />
        <View style={styles.divider} />

        {/* APPS */}
        <Pressable onPress={props.onOpenAppPicker} accessibilityRole="button">
          {({ pressed }) => (
            <View style={pressed ? { opacity: 0.6 } : undefined}>
              <Text style={styles.fieldLabel}>BLOCKED APPS</Text>
              <Text style={styles.fieldValue}>
                {draft.blockedApps.length === 0
                  ? "NONE — TAP TO PICK"
                  : `${draft.blockedApps.length} SELECTED — TAP TO EDIT`}
              </Text>
            </View>
          )}
        </Pressable>
        <View style={styles.divider} />

        {/* SCHEDULE */}
        <View style={styles.scheduleHeader}>
          <Text style={styles.fieldLabel}>SCHEDULE</Text>
          <Pressable
            onPress={props.onToggleScheduleExists}
            accessibilityRole="button"
            accessibilityLabel={
              schedule ? "Remove schedule" : "Add schedule"
            }
          >
            {({ pressed }) => (
              <Text
                style={[styles.smallAction, pressed && styles.smallActionPressed]}
              >
                {schedule ? "[ REMOVE ]" : "[ ADD ]"}
              </Text>
            )}
          </Pressable>
        </View>

        {schedule == null ? (
          <Text style={styles.fieldValue}>ALWAYS ON — APPS BLOCKED 24/7.</Text>
        ) : (
          <>
            <Pressable
              onPress={props.onToggleScheduleEnabled}
              accessibilityRole="switch"
              accessibilityState={{ checked: schedule.enabled }}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.scheduleEnabledRow,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  {schedule.enabled ? "[ ON ]" : "[ OFF ]"}  TAP TO TOGGLE
                </Text>
              )}
            </Pressable>

            <View style={styles.timeRow}>
              <View style={styles.timeCell}>
                <Text style={styles.subLabel}>START</Text>
                <TextInput
                  value={props.startInput}
                  onChangeText={props.onChangeStart}
                  onBlur={props.onCommitStart}
                  onSubmitEditing={props.onCommitStart}
                  keyboardType="numbers-and-punctuation"
                  placeholder="HH:MM"
                  placeholderTextColor={DIM}
                  style={styles.timeField}
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={5}
                />
              </View>
              <Text style={styles.timeArrow}>→</Text>
              <View style={styles.timeCell}>
                <Text style={styles.subLabel}>END</Text>
                <TextInput
                  value={props.endInput}
                  onChangeText={props.onChangeEnd}
                  onBlur={props.onCommitEnd}
                  onSubmitEditing={props.onCommitEnd}
                  keyboardType="numbers-and-punctuation"
                  placeholder="HH:MM"
                  placeholderTextColor={DIM}
                  style={styles.timeField}
                  autoCorrect={false}
                  autoComplete="off"
                  maxLength={5}
                />
              </View>
            </View>

            <Text style={styles.subLabel}>DAYS</Text>
            <View style={styles.daysRow}>
              {DAY_LABELS.map((label, idx) => {
                const on = schedule.days.includes(idx);
                return (
                  <Pressable
                    key={label}
                    onPress={() => props.onToggleDay(idx)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${label}${on ? " selected" : ""}`}
                  >
                    {({ pressed }) => (
                      <Text
                        style={[
                          styles.dayPill,
                          on ? styles.dayPillOn : styles.dayPillOff,
                          pressed && { opacity: 0.6 },
                        ]}
                      >
                        {label}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View style={styles.modalSpacer} />

        {!props.isNew && (
          <Pressable onPress={props.onDelete} accessibilityRole="button">
            {({ pressed }) => (
              <Text
                style={[styles.dangerAction, pressed && styles.dangerActionPressed]}
              >
                [ DELETE PROFILE ]
              </Text>
            )}
          </Pressable>
        )}

        <Pressable onPress={props.onSave} accessibilityRole="button">
          {({ pressed }) => (
            <Text
              style={[styles.modalAction, pressed && styles.modalActionPressed]}
            >
              [ SAVE ]
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/* ── App picker view (inside the picker modal) ─────────────────────────── */

interface AppPickerViewProps {
  apps: InstalledApp[];
  selected: Set<string>;
  onToggle: (pkg: string) => void;
  onClose: () => void;
  topPad: number;
}

function AppPickerView(props: AppPickerViewProps) {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InstalledApp>) => {
      const on = props.selected.has(item.packageName);
      return (
        <Pressable
          onPress={() => props.onToggle(item.packageName)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
        >
          {({ pressed }) => (
            <View
              style={[
                styles.pickerRow,
                pressed && styles.pickerRowPressed,
              ]}
            >
              <Text style={styles.pickerCheck}>{on ? "[X]" : "[ ]"}</Text>
              <Text style={styles.pickerName} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          )}
        </Pressable>
      );
    },
    [props]
  );

  const Header = (
    <View style={{ paddingHorizontal: 20 }}>
      <View style={styles.headerRow}>
        <View style={styles.headerLinkSpacer} />
        <Text style={styles.appName}>PICK APPS</Text>
        <Pressable onPress={props.onClose} accessibilityRole="button">
          {({ pressed }) => (
            <Text
              style={[styles.headerLink, pressed && styles.headerLinkPressed]}
            >
              {"[ DONE ]"}
            </Text>
          )}
        </Pressable>
      </View>
      <View style={styles.divider} />
      <Text style={styles.intro}>
        TAP TO TOGGLE.  {props.selected.size} SELECTED.
      </Text>
      <View style={styles.divider} />
    </View>
  );

  return (
    <View style={[styles.modalRoot, { paddingTop: props.topPad + 24 }]}>
      <FlatList
        data={props.apps}
        renderItem={renderItem}
        keyExtractor={(a) => a.packageName}
        ListHeaderComponent={Header}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        windowSize={10}
        removeClippedSubviews
      />
    </View>
  );
}

/* ── Pure helpers ──────────────────────────────────────────────────────── */

/**
 * Human-readable summary for the profile-list row. Examples:
 *   "ALWAYS ON"
 *   "DISABLED"
 *   "09:00→17:00 · MON TUE WED THU FRI"
 *   "22:00→06:00 · DAILY"   (overnight, all 7 days)
 *   "NO DAYS"               (schedule with empty days)
 */
function describeSchedule(schedule: FocusSchedule | null): string {
  if (schedule == null) return "ALWAYS ON";
  if (!schedule.enabled) return "DISABLED";
  if (schedule.days.length === 0) return "NO DAYS";
  const time = `${formatTime(schedule.startMinute)}→${formatTime(schedule.endMinute)}`;
  let dayStr: string;
  if (schedule.days.length === 7) {
    dayStr = "DAILY";
  } else if (
    schedule.days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => schedule.days.includes(d))
  ) {
    dayStr = "WEEKDAYS";
  } else if (
    schedule.days.length === 2 &&
    schedule.days.includes(0) &&
    schedule.days.includes(6)
  ) {
    dayStr = "WEEKENDS";
  } else {
    dayStr = schedule.days
      .slice()
      .sort((a, b) => a - b)
      .map((d) => DAY_LABELS[d])
      .join(" ");
  }
  return `${time} · ${dayStr}`;
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header row shared between list/editor/picker — three-cell layout so
  // the title stays centered no matter the side links' widths.
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginHorizontal: -20,
  },
  headerLink: {
    color: FG,
    fontFamily: MONO,
    fontWeight: "900",
    fontSize: 13,
    minWidth: 80,
  },
  headerLinkPressed: { color: "#888888" },
  headerLinkSpacer: { minWidth: 80 },

  appName: {
    color: FG,
    fontFamily: MONO,
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 2,
    textAlign: "center",
  },

  divider: {
    borderBottomColor: FG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },

  intro: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    paddingHorizontal: 20,
  },

  // ── Profile list rows
  profileRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  profileRowPressed: { opacity: 0.6 },
  profileRowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileName: {
    color: FG,
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    flexShrink: 1,
    paddingRight: 12,
  },
  profileMeta: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    letterSpacing: 1,
  },
  statusActive: {
    color: FG,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  statusIdle: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },

  emptyText: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },

  // ── Big actions (NEW / SAVE)
  bigAction: {
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
    paddingVertical: 16,
  },
  bigActionPressed: { color: "#888888" },

  // ── Editor / shared modal layout
  modalRoot: { flex: 1, backgroundColor: BG },
  modalInner: { flex: 1, paddingHorizontal: 20 },

  fieldLabel: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 6,
    marginTop: 4,
  },
  fieldValue: {
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
  subLabel: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 4,
    marginTop: 8,
  },

  textField: {
    color: FG,
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },

  scheduleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  smallAction: {
    color: FG,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  smallActionPressed: { color: "#888888" },

  scheduleEnabledRow: {
    color: FG,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
    marginVertical: 8,
  },

  timeRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 4,
  },
  timeCell: { flex: 1 },
  timeField: {
    color: FG,
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 2,
    paddingVertical: 4,
  },
  timeArrow: {
    color: FG,
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: "900",
    paddingHorizontal: 12,
    paddingBottom: 6,
  },

  daysRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  dayPill: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  dayPillOn: { color: FG },
  dayPillOff: { color: DIM },

  modalSpacer: { flex: 1, minHeight: 24 },

  modalAction: {
    color: FG,
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
    paddingVertical: 16,
  },
  modalActionPressed: { color: "#888888" },

  dangerAction: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
    paddingVertical: 12,
  },
  dangerActionPressed: { color: FG },

  // ── App picker rows
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  pickerRowPressed: { opacity: 0.6 },
  pickerCheck: {
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: "900",
    width: 36,
  },
  pickerName: {
    color: FG,
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 1,
    flexShrink: 1,
  },
});
