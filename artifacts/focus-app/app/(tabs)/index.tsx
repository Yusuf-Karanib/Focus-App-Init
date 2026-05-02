import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  ListRenderItemInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import {
  FocusModule,
  InstalledApp,
  isFocusModuleAvailable,
} from "../../modules/focus-module";

const BG = "#000000";
const FG = "#ffffff";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

// How long the "BLOCKED" warning stays visible after tapping a blocked app.
const WARNING_VISIBLE_MS = 2_500;

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
  const [loading, setLoading] = useState<boolean>(true);
  const [warning, setWarning] = useState<string | null>(null);

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
    setLoading(false);
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
      {warning && <Text style={styles.warning}>{warning}</Text>}
    </View>
  );

  const Empty = (
    <View style={{ paddingHorizontal: 20 }}>
      <Text style={styles.bodyMuted}>
        {loading
          ? "LOADING APPS…"
          : isFocusModuleAvailable
            ? "NO LAUNCHABLE APPS FOUND."
            : "NO APPS AVAILABLE — RUN ON AN ANDROID DEVICE."}
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: topPad + 24 }]}>
      <FlatList
        data={sortedApps}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={Header}
        ListEmptyComponent={Empty}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        windowSize={10}
        removeClippedSubviews
      />
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
    color: "#666666",
  },

  // Pressed feedback — uniform across both blocked and launchable rows.
  rowPressed: {
    color: "#888888",
  },

  bodyMuted: {
    color: "#888888",
    fontFamily: MONO,
    fontSize: 14,
    letterSpacing: 1,
  },
});
