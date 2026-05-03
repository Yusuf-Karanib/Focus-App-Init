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
import { useRouter } from "expo-router";

import {
  FocusModule,
  InstalledApp,
} from "../../modules/focus-module";
import { useFocusProfiles } from "../../lib/profiles";

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

// ── Mindful Delay ──────────────────────────────────────────────────────────
// How many seconds the breathing-room overlay forces the user to wait before
// the CONTINUE button appears, when they tap a blocked app from the launcher.
// Long enough to interrupt autopilot scrolling muscle memory, short enough
// to feel like deliberate friction rather than punishment. Adjust here if the
// number ever needs tuning — single source of truth.
const MINDFUL_DELAY_SECONDS = 15;

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

  const router = useRouter();

  // Source of truth for the blocked set is now Focus Profiles. The hook
  // loads profiles from AsyncStorage, evaluates which schedules are active
  // RIGHT NOW, and pushes the resulting union to the native AccessibilityService
  // (via FocusModule.setBlockedApps). The launcher just consumes the
  // already-computed set for row-dimming and the Mindful Delay gate.
  const { activeBlockedSet: blockedSet } = useFocusProfiles();

  const [apps, setApps] = useState<InstalledApp[]>([]);
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

  // ── Mindful Delay state ─────────────────────────────────────────────────
  // The blocked app the user has chosen to attempt to open. `null` means the
  // overlay is closed; any non-null value opens the modal. Using the app
  // object itself (not just a flag) lets the modal display the app name and
  // launch it on confirm without needing a second piece of state to track
  // *which* app to launch. Seconds-left ticks from MINDFUL_DELAY_SECONDS
  // down to 0; the CONTINUE button is hidden until it reaches 0.
  const [mindfulDelayApp, setMindfulDelayApp] = useState<InstalledApp | null>(
    null
  );
  const [mindfulSecondsLeft, setMindfulSecondsLeft] = useState<number>(
    MINDFUL_DELAY_SECONDS
  );

  // Keep a ref to the warning timer so we can cancel it if a new warning
  // arrives before the previous one has cleared.
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data load ──────────────────────────────────────────────────────────
  // We only load installed apps here. The blocked set comes from
  // useFocusProfiles() above — which also handles re-evaluating it on
  // schedule transitions and on app foregrounding, so this screen no
  // longer needs to manage that lifecycle.
  const loadAll = useCallback(() => {
    let installed: InstalledApp[] = [];
    try {
      installed = FocusModule.getInstalledApps();
    } catch {
      installed = [];
    }
    setApps(installed);
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

  // ── Mindful Delay countdown ────────────────────────────────────────────
  // When the overlay opens (mindfulDelayApp transitions null → non-null),
  // reset the counter and start a 1-second interval that decrements it.
  // Clamps at 0 so the interval keeps ticking harmlessly even after the
  // CONTINUE button becomes available — simpler than racing to clear it.
  // The cleanup function clears the interval on close, on unmount, or
  // whenever the modal target switches (which shouldn't happen in practice
  // but is correct by construction).
  useEffect(() => {
    if (!mindfulDelayApp) return;
    setMindfulSecondsLeft(MINDFUL_DELAY_SECONDS);
    const id = setInterval(() => {
      setMindfulSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [mindfulDelayApp]);

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
        // Blocked tap → open the Mindful Delay overlay instead of launching.
        // The overlay decides (after the 15-second breath) whether the app
        // actually opens. We do NOT call showWarning here — the overlay IS
        // the user-facing feedback, a transient banner on top would just
        // add noise.
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        setMindfulDelayApp(app);
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

  // ── Mindful Delay handlers ─────────────────────────────────────────────
  // STAY FOCUSED — the path of least resistance and the one we want to
  // reward, so we use a Success haptic. Closing the overlay without
  // launching the app is the win condition for FocusApp.
  const cancelMindfulDelay = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setMindfulDelayApp(null);
  }, []);

  // CONTINUE — only valid once the countdown has hit zero. We snapshot the
  // target app into a local var BEFORE clearing it, because closing the
  // modal triggers the cleanup useEffect which can race with the launchApp
  // call if we read from state. Light haptic (not Warning) — the user has
  // earned this; no shaming.
  const confirmMindfulDelay = useCallback(() => {
    if (mindfulSecondsLeft > 0) return;
    const target = mindfulDelayApp;
    setMindfulDelayApp(null);
    if (!target) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const ok = (() => {
      try {
        return FocusModule.launchApp(target.packageName);
      } catch {
        return false;
      }
    })();
    if (!ok) {
      showWarning(`COULDN'T LAUNCH: ${target.name.toUpperCase()}`);
    }
  }, [mindfulDelayApp, mindfulSecondsLeft]);

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

      {/* Entry point to the Focus Profiles management screen. Kept as a
          plain text link rather than a button so the brutalist visual
          rhythm of the header isn't broken — same shape as [ ON ] / [ OFF ]
          on the row above. */}
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          router.push("/profiles");
        }}
        accessibilityRole="button"
        accessibilityLabel="Manage focus profiles"
        style={styles.toggleRow}
      >
        <Text style={styles.toggleLabel}>PROFILES</Text>
        <Text style={styles.toggleStateOn}>[ MANAGE → ]</Text>
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

      {/* ── Mindful Delay overlay ───────────────────────────────────────
          Opened when the user taps a blocked app from the launcher list.
          A 15-second countdown gates the CONTINUE button; STAY FOCUSED is
          available throughout. This is the launcher-side analog of the
          native NudgeActivity (which catches blocked apps opened from
          outside FocusApp — notifications, recents, etc.).
      */}
      <Modal
        visible={mindfulDelayApp !== null}
        transparent={false}
        animationType="none"
        onRequestClose={cancelMindfulDelay}
        statusBarTranslucent
      >
        <View style={styles.modalRoot}>
          <View style={[styles.modalInner, { paddingTop: topPad + 24 }]}>
            <Text style={styles.appName}>FOCUSAPP</Text>
            <View style={styles.divider} />

            <Text style={styles.modalWarnBar}>
              {`  ! ${(mindfulDelayApp?.name ?? "").toUpperCase()} IS BLOCKED  `}
            </Text>

            <Text style={styles.modalBody}>
              TAKE A DEEP BREATH.{"\n"}
              DO YOU REALLY NEED TO OPEN THIS RIGHT NOW?
            </Text>

            {/* Countdown — pad to 2 digits so the layout doesn't jump as
                the value drops from 10 to 9. Centered visually, big enough
                that it's the focal point of the screen. */}
            <View style={styles.mindfulCountdownWrap}>
              <Text style={styles.mindfulCountdown}>
                {String(mindfulSecondsLeft).padStart(2, "0")}
              </Text>
              <Text style={styles.mindfulCountdownLabel}>SECONDS</Text>
            </View>

            <View style={styles.modalSpacer} />

            <Pressable
              onPress={cancelMindfulDelay}
              accessibilityRole="button"
              accessibilityLabel="Stay focused and go back"
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.modalAction,
                    pressed && styles.modalActionPressed,
                  ]}
                >
                  [ STAY FOCUSED — GO BACK ]
                </Text>
              )}
            </Pressable>

            {/* CONTINUE is fully hidden (not disabled) until the timer
                hits 0. The user shouldn't see a non-functional button
                during the breath — that would invite anxious tapping. */}
            {mindfulSecondsLeft === 0 && (
              <Pressable
                onPress={confirmMindfulDelay}
                accessibilityRole="button"
                accessibilityLabel={`Continue to ${mindfulDelayApp?.name ?? ""}`}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.modalAction,
                      pressed && styles.modalActionPressed,
                    ]}
                  >
                    {`[ CONTINUE TO ${(mindfulDelayApp?.name ?? "").toUpperCase()} ]`}
                  </Text>
                )}
              </Pressable>
            )}
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

  // ── Mindful Delay countdown ────────────────────────────────────────────
  // Big, centered, monospace. The wrap centers the number + label as a
  // unit on the cross axis; the inner Texts use the same font family as
  // the rest of the brutalist UI but at much larger sizes.
  mindfulCountdownWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 24,
  },
  mindfulCountdown: {
    color: FG,
    fontFamily: MONO,
    fontSize: 96,
    fontWeight: "900",
    letterSpacing: 4,
    lineHeight: 104,
  },
  mindfulCountdownLabel: {
    color: DIM,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 3,
    marginTop: 4,
  },
});
