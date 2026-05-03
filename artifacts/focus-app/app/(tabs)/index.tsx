import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
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
import * as Haptics from "expo-haptics";

import {
  FocusModule,
  InstalledApp,
} from "../../modules/focus-module";

const BG = "#000000";
const FG = "#ffffff";
const DIM = "#666666";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

// How long the "BLOCKED" warning stays visible after tapping a blocked app.
const WARNING_VISIBLE_MS = 2_500;

// ── Friction phrases ────────────────────────────────────────────────────────
// Pool of phrases the user must type verbatim to disable Focus Mode. Picked
// at random every time the friction modal opens so muscle memory doesn't form
// — this is the entire point of the friction. Case-sensitive on submit.
//
// Keep them:
//   - long enough to be annoying (15-30 chars), but
//   - short enough to be feasible on a phone keyboard, and
//   - emotionally honest — they should make the user notice the choice they
//     are making in the moment.
const FRICTION_PHRASES: readonly string[] = [
  "I am choosing distraction",
  "I am giving up my focus",
  "I want to scroll instead of work",
  "I am breaking my own rule",
  "I will regret this in ten minutes",
] as const;

function pickFrictionPhrase(): string {
  const i = Math.floor(Math.random() * FRICTION_PHRASES.length);
  return FRICTION_PHRASES[i] ?? FRICTION_PHRASES[0]!;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  // Hidden apps are stronger than blocked apps: blocked apps still appear
  // in the launcher list (dimmed) and surface a warning when tapped, but
  // hidden apps are filtered out entirely before render — they don't exist
  // as far as the UI is concerned. A future step will add UI / persistence
  // for managing this set; for now it lives only in component state.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hiddenApps, setHiddenApps] = useState<Set<string>>(() => new Set());
  const [warning, setWarning] = useState<string | null>(null);

  // ── Focus Mode state ─────────────────────────────────────────────────────
  // Default ON — this is a focus app, the whole point is that you boot into
  // it already protected. Currently in-memory only; persistence and the
  // actual side-effect (telling the native module to suspend blocking when
  // OFF) are future steps. See the deliberate TODO note below the modal.
  const [focusModeEnabled, setFocusModeEnabled] = useState<boolean>(true);

  // Friction modal — opened the moment the user taps the toggle while it's ON.
  // The phrase is fixed for the lifetime of *this* modal instance: we pick
  // once on open and don't re-roll on each keystroke.
  const [frictionOpen, setFrictionOpen] = useState<boolean>(false);
  const [frictionPhrase, setFrictionPhrase] = useState<string>("");
  const [frictionInput, setFrictionInput] = useState<string>("");

  // Keep a ref to the warning timer so we can cancel it if a new warning
  // arrives before the previous one has cleared.
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data load ──────────────────────────────────────────────────────────
  const loadAll = useCallback(() => {
    let installed: InstalledApp[] = [];
    let blocked: string[] = [];
    try {
      installed = FocusModule.getInstalledApps();
    } catch {
      installed = [];
    }
    try {
      blocked = FocusModule.getBlockedApps();
    } catch {
      blocked = [];
    }
    setApps(installed);
    setBlockedSet(new Set(blocked));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Re-sync whenever the launcher comes back to the foreground — the user
  // may have installed / uninstalled apps, or changed the blocklist from
  // somewhere else.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") loadAll();
    });
    return () => sub.remove();
  }, [loadAll]);

  // Clean up the warning timer on unmount.
  useEffect(() => {
    return () => {
      if (warningTimer.current) clearTimeout(warningTimer.current);
    };
  }, []);

  // ── Visible list (filter hidden, then sort alphabetically) ─────────────
  // Order matters: filter first so we don't waste cycles sorting entries
  // we're about to drop. Native side already sorts by lowercased name, but
  // we re-sort defensively so this stays correct even if a future change
  // drops the native ordering.
  //
  // Hidden apps are removed from the array entirely — there is intentionally
  // no visual marker, no row, no "ghost" placeholder. From the launcher's
  // point of view, a hidden app simply does not exist.
  const sortedApps = useMemo(() => {
    return apps
      .filter((app) => !hiddenApps.has(app.packageName))
      .sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
  }, [apps, hiddenApps]);

  // ── Tap handler ────────────────────────────────────────────────────────
  const handleTap = useCallback(
    (app: InstalledApp) => {
      if (blockedSet.has(app.packageName)) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        showWarning(`BLOCKED: ${app.name.toUpperCase()}`);
        return;
      }

      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const ok = (() => {
        try {
          return FocusModule.launchApp(app.packageName);
        } catch {
          return false;
        }
      })();

      if (!ok) {
        showWarning(`COULDN'T LAUNCH: ${app.name.toUpperCase()}`);
      }
    },
    [blockedSet]
  );

  function showWarning(message: string) {
    if (warningTimer.current) clearTimeout(warningTimer.current);
    setWarning(message);
    warningTimer.current = setTimeout(() => {
      setWarning(null);
      warningTimer.current = null;
    }, WARNING_VISIBLE_MS);
  }

  // ── Focus Mode toggle ──────────────────────────────────────────────────
  // Going OFF requires friction: tapping the toggle while it's ON opens the
  // modal instead of flipping state. Going ON is free — turning protection
  // on is always a good thing and never gated.
  //
  // Future wiring: when this flips, we should also notify the native
  // module so the AccessibilityService stops nudging while OFF (and
  // resumes when ON). That's out of scope for this UI step and intentionally
  // not implemented here — see the TODO at the end of this file.
  const handleToggleFocusMode = useCallback(() => {
    if (focusModeEnabled) {
      // Turning OFF — gate behind the typed-phrase friction.
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      setFrictionPhrase(pickFrictionPhrase());
      setFrictionInput("");
      setFrictionOpen(true);
    } else {
      // Turning ON — instant, no friction, gives a positive haptic.
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setFocusModeEnabled(true);
    }
  }, [focusModeEnabled]);

  // Case-sensitive, whitespace-sensitive exact match. The whole point of the
  // friction is that the user has to look at the phrase and type it
  // deliberately — auto-trim or case-folding would defeat that.
  const frictionMatches =
    frictionInput.length > 0 && frictionInput === frictionPhrase;

  const confirmFrictionUnlock = useCallback(() => {
    if (!frictionMatches) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setFocusModeEnabled(false);
    setFrictionOpen(false);
    setFrictionInput("");
  }, [frictionMatches]);

  const cancelFriction = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setFrictionOpen(false);
    setFrictionInput("");
  }, []);

  // ── Row renderer ───────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InstalledApp>) => {
      const isBlocked = blockedSet.has(item.packageName);
      return (
        <Pressable
          onPress={() => handleTap(item)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={
            isBlocked ? `${item.name} (blocked)` : `Launch ${item.name}`
          }
        >
          {({ pressed }) => (
            <Text
              style={[
                styles.row,
                isBlocked && styles.rowBlocked,
                pressed && styles.rowPressed,
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.name}
            </Text>
          )}
        </Pressable>
      );
    },
    [blockedSet, handleTap]
  );

  const keyExtractor = useCallback(
    (item: InstalledApp) => item.packageName,
    []
  );

  // ── Header / footer ────────────────────────────────────────────────────
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const Header = (
    <View style={{ paddingHorizontal: 20 }}>
      <Text style={styles.appName}>FOCUSAPP</Text>
      <View style={styles.divider} />

      {/* Focus Mode toggle row — brutalist text "switch" matching the rest
          of the UI. Tap area is the entire row for thumb-friendliness. */}
      <Pressable
        onPress={handleToggleFocusMode}
        accessibilityRole="switch"
        accessibilityState={{ checked: focusModeEnabled }}
        accessibilityLabel={
          focusModeEnabled
            ? "Focus mode is on. Tap to turn off."
            : "Focus mode is off. Tap to turn on."
        }
        style={styles.toggleRow}
      >
        <Text style={styles.toggleLabel}>FOCUS MODE</Text>
        <Text
          style={[
            styles.toggleState,
            focusModeEnabled ? styles.toggleStateOn : styles.toggleStateOff,
          ]}
        >
          {focusModeEnabled ? "[ ON ]" : "[ OFF ]"}
        </Text>
      </Pressable>
      <View style={styles.divider} />

      {warning && <Text style={styles.warning}>{warning}</Text>}
    </View>
  );

  // No ListEmptyComponent — when the list is empty (initial load, or
  // genuinely no launchable apps on the device) we render the header alone
  // and nothing below it. Brutalist: the absence IS the message.

  return (
    <View style={[styles.root, { paddingTop: topPad + 24 }]}>
      <FlatList
        data={sortedApps}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={Header}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        windowSize={10}
        removeClippedSubviews
      />

      {/* ── Friction modal ──────────────────────────────────────────────
          Required-typing gate before Focus Mode can be turned OFF. We use
          react-native's built-in Modal (animationType="none" to match the
          rest of the brutalist UI — no fade, no slide), full-screen black
          background, monospace everything. */}
      <Modal
        visible={frictionOpen}
        transparent={false}
        animationType="none"
        onRequestClose={cancelFriction}
        statusBarTranslucent
      >
        <View style={styles.modalRoot}>
          <View style={[styles.modalInner, { paddingTop: topPad + 24 }]}>
            <Text style={styles.appName}>FOCUSAPP</Text>
            <View style={styles.divider} />

            <Text style={styles.modalWarnBar}>
              {"  ! TURNING OFF FOCUS MODE  "}
            </Text>

            <Text style={styles.modalBody}>
              TO DISABLE PROTECTION, TYPE THE PHRASE BELOW EXACTLY AS SHOWN.
            </Text>

            <Text style={styles.modalPhrase}>{frictionPhrase}</Text>

            <TextInput
              value={frictionInput}
              onChangeText={setFrictionInput}
              placeholder="TYPE HERE"
              placeholderTextColor={DIM}
              style={styles.modalInput}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Type the phrase to confirm"
            />

            <View style={styles.modalSpacer} />

            <Pressable
              onPress={cancelFriction}
              accessibilityRole="button"
              accessibilityLabel="Cancel and keep focus mode on"
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.modalAction,
                    pressed && styles.modalActionPressed,
                  ]}
                >
                  [ CANCEL — KEEP FOCUS MODE ON ]
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={confirmFrictionUnlock}
              disabled={!frictionMatches}
              accessibilityRole="button"
              accessibilityState={{ disabled: !frictionMatches }}
              accessibilityLabel="Turn focus mode off"
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.modalAction,
                    !frictionMatches && styles.modalActionDisabled,
                    pressed && frictionMatches && styles.modalActionPressed,
                  ]}
                >
                  [ TURN OFF FOCUS MODE ]
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/*
        TODO (next step): wire `focusModeEnabled` to the native module so
        that when OFF the AccessibilityService stops launching NudgeActivity
        and the NotificationListener stops cancelling notifications. Two
        viable shapes:
          (a) FocusModule.setFocusModeEnabled(boolean) → writes a bool into
              the same SharedPreferences file the services already read.
          (b) Treat OFF as "blocked list is empty" — simpler, no new prefs
              key, but loses the user's blocklist while OFF (probably fine).
        Deliberately not implemented in this UI-friction step.
      */}
    </View>
  );
}

/* ── Styles — strict monochrome, no borders / shadows / rounded corners ─── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },

  appName: {
    color: FG,
    fontFamily: MONO,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 16,
  },

  divider: {
    height: 1,
    backgroundColor: FG,
    marginBottom: 16,
  },

  // ── Focus Mode toggle ──────────────────────────────────────────────────
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    marginBottom: 12,
  },
  toggleLabel: {
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  toggleState: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  toggleStateOn: {
    color: BG,
    backgroundColor: FG,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  toggleStateOff: {
    color: DIM,
  },

  warning: {
    color: BG,
    backgroundColor: FG,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignSelf: "flex-start",
    overflow: "hidden",
    marginBottom: 16,
  },

  row: {
    color: FG,
    backgroundColor: BG,
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: "500",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  // Blocked entries are visually muted but still tappable so the user can
  // see the warning. No strikethrough or icons — just dimmer text.
  rowBlocked: {
    color: DIM,
  },

  // Pressed feedback — uniform across both blocked and launchable rows.
  rowPressed: {
    color: "#888888",
  },

  // ── Friction modal ─────────────────────────────────────────────────────
  modalRoot: {
    flex: 1,
    backgroundColor: BG,
  },
  modalInner: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  modalWarnBar: {
    color: BG,
    backgroundColor: FG,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignSelf: "flex-start",
    overflow: "hidden",
    marginBottom: 20,
  },
  modalBody: {
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.5,
    marginBottom: 24,
  },
  // The phrase the user must type — large, easy to read, displayed exactly
  // as they must type it (case included).
  modalPhrase: {
    color: FG,
    fontFamily: MONO,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 30,
    letterSpacing: 0.5,
    marginBottom: 20,
  },
  modalInput: {
    color: FG,
    backgroundColor: "#111111",
    fontFamily: MONO,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0.5,
    padding: 12,
    minHeight: 80,
  },
  modalSpacer: {
    flex: 1,
  },
  modalAction: {
    color: FG,
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    paddingVertical: 14,
  },
  modalActionPressed: {
    color: "#888888",
  },
  modalActionDisabled: {
    color: DIM,
  },
});
