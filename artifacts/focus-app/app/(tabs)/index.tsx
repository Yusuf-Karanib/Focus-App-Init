import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Animated,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";

import { FocusModule, isFocusModuleAvailable } from "../../modules/focus-module";

const DEFAULT_BLOCKED: string[] = [
  "com.instagram.android",
  "com.zhiliaoapp.musically",
  "com.google.android.youtube",
];

const PACKAGE_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const c = isDark ? dark : light;

  const [isEnabled, setIsEnabled] = useState(false);
  const [scale] = useState(new Animated.Value(1));
  const [packageInput, setPackageInput] = useState("");
  const [blockedPackages, setBlockedPackages] = useState<string[]>(DEFAULT_BLOCKED);
  const [error, setError] = useState<string | null>(null);
  const [serviceEnabled, setServiceEnabled] = useState<boolean>(false);

  const checkServiceStatus = useCallback(() => {
    try {
      setServiceEnabled(FocusModule.isServiceEnabled());
    } catch {
      setServiceEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (!isFocusModuleAvailable) return;
    try {
      const existing = FocusModule.getBlockedApps();
      if (existing.length > 0) setBlockedPackages(existing);
    } catch {
      /* keep defaults */
    }
  }, []);

  // Re-check accessibility permission on mount and whenever the app comes
  // back to the foreground (i.e. after the user returns from system Settings).
  useEffect(() => {
    checkServiceStatus();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkServiceStatus();
    });
    return () => sub.remove();
  }, [checkServiceStatus]);

  function handleGrantPermission() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      FocusModule.openAccessibilitySettings();
    } catch {
      /* no-op fallback handles web/Expo Go */
    }
  }

  useEffect(() => {
    try {
      FocusModule.setBlockedApps(blockedPackages);
    } catch {
      /* no-op fallback handles web/Expo Go */
    }
  }, [blockedPackages]);

  const trimmedInput = packageInput.trim().toLowerCase();
  const isValidInput = useMemo(() => PACKAGE_REGEX.test(trimmedInput), [trimmedInput]);
  const isDuplicate = blockedPackages.includes(trimmedInput);
  const addDisabled = !trimmedInput || !isValidInput || isDuplicate;

  function handleToggle(value: boolean) {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();

    if (Platform.OS !== "web") {
      Haptics.impactAsync(
        value ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
      );
    }

    setIsEnabled(value);
  }

  function handleAdd() {
    setError(null);
    if (!trimmedInput) return setError("Enter a package name first.");
    if (!isValidInput) return setError('Use a format like "com.instagram.android".');
    if (isDuplicate) return setError("That app is already on the blocklist.");

    setBlockedPackages((prev) => [...prev, trimmedInput]);
    setPackageInput("");

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  function handleRemove(pkg: string) {
    setBlockedPackages((prev) => prev.filter((p) => p !== pkg));
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={[styles.root, { backgroundColor: c.bg }]}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPad + 20,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 20),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Minimal header */}
        <Text style={[styles.appName, { color: c.text }]}>FocusApp</Text>

        {/* ── Permission banner (only when service is not granted) ───────── */}
        {!serviceEnabled && (
          <Pressable
            onPress={handleGrantPermission}
            style={({ pressed }) => [
              styles.permissionBanner,
              {
                backgroundColor: c.warningBg,
                borderColor: c.warningBorder,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Grant Accessibility Permission"
          >
            <View
              style={[
                styles.permissionIconWrap,
                { backgroundColor: c.warningIconBg },
              ]}
            >
              <Feather name="alert-triangle" size={20} color={c.warningIcon} />
            </View>
            <View style={styles.permissionText}>
              <Text style={[styles.permissionTitle, { color: c.warningText }]}>
                Grant Accessibility Permission
              </Text>
              <Text style={[styles.permissionSub, { color: c.warningSub }]}>
                Required for FocusApp to block apps. Tap to open Settings.
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={c.warningSub} />
          </Pressable>
        )}

        {/* ── FOCAL POINT 1: Focus Mode toggle ───────────────────────────── */}
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            onPress={() => handleToggle(!isEnabled)}
            style={[
              styles.heroCard,
              {
                backgroundColor: isEnabled ? c.primary : c.cardBg,
                borderColor: isEnabled ? c.primary : c.border,
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: isEnabled }}
            accessibilityLabel="Focus mode toggle"
          >
            <View style={styles.heroTop}>
              <View
                style={[
                  styles.heroIconWrap,
                  {
                    backgroundColor: isEnabled
                      ? "rgba(255,255,255,0.18)"
                      : c.iconBg,
                  },
                ]}
              >
                <Feather
                  name={isEnabled ? "shield" : "shield-off"}
                  size={32}
                  color={isEnabled ? "#ffffff" : c.muted}
                />
              </View>

              <Switch
                value={isEnabled}
                onValueChange={handleToggle}
                trackColor={{
                  false: c.switchTrackOff,
                  true: "rgba(255,255,255,0.35)",
                }}
                thumbColor="#ffffff"
                ios_backgroundColor={c.switchTrackOff}
                style={styles.heroSwitch}
              />
            </View>

            <View style={styles.heroText}>
              <Text
                style={[
                  styles.heroTitle,
                  { color: isEnabled ? "#ffffff" : c.text },
                ]}
              >
                Focus Mode
              </Text>
              <Text
                style={[
                  styles.heroStatus,
                  {
                    color: isEnabled
                      ? "rgba(255,255,255,0.85)"
                      : c.muted,
                  },
                ]}
              >
                {isEnabled
                  ? `On — blocking ${blockedPackages.length} app${blockedPackages.length === 1 ? "" : "s"}`
                  : "Off — tap to start"}
              </Text>
            </View>
          </Pressable>
        </Animated.View>

        {/* ── FOCAL POINT 2: Add to blocklist ────────────────────────────── */}
        <View
          style={[
            styles.inputHero,
            {
              backgroundColor: c.cardBg,
              borderColor: error ? c.danger : c.border,
            },
          ]}
        >
          <TextInput
            value={packageInput}
            onChangeText={(t) => {
              setPackageInput(t);
              if (error) setError(null);
            }}
            placeholder="com.instagram.android"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="done"
            onSubmitEditing={handleAdd}
            style={[styles.inputHeroField, { color: c.text }]}
          />
          <Pressable
            onPress={handleAdd}
            disabled={addDisabled}
            style={({ pressed }) => [
              styles.inputHeroButton,
              {
                backgroundColor: addDisabled ? c.iconBg : c.primary,
                opacity: pressed && !addDisabled ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add to blocklist"
          >
            <Feather
              name="plus"
              size={22}
              color={addDisabled ? c.muted : "#ffffff"}
            />
          </Pressable>
        </View>

        {error && (
          <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
        )}

        {/* Compact blocklist (secondary) */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.muted }]}>
            BLOCKLIST · {blockedPackages.length}
          </Text>

          {blockedPackages.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: c.cardBg, borderColor: c.border },
              ]}
            >
              <Text style={[styles.emptyText, { color: c.muted }]}>
                No apps blocked. Add one above.
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.listCard,
                { backgroundColor: c.cardBg, borderColor: c.border },
              ]}
            >
              {blockedPackages.map((pkg, i) => (
                <View key={pkg}>
                  <View style={styles.row}>
                    <Text
                      style={[styles.rowText, { color: c.text }]}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {pkg}
                    </Text>
                    <Pressable
                      onPress={() => handleRemove(pkg)}
                      style={({ pressed }) => [
                        styles.removeBtn,
                        { opacity: pressed ? 0.5 : 1 },
                      ]}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${pkg}`}
                    >
                      <Feather name="x" size={16} color={c.muted} />
                    </Pressable>
                  </View>
                  {i < blockedPackages.length - 1 && (
                    <View
                      style={[styles.divider, { backgroundColor: c.border }]}
                    />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ── Tokens ─────────────────────────────────────────────────────────────── */

const light = {
  bg: "#f8fafc",
  cardBg: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  primary: "#2563eb",
  iconBg: "#f1f5f9",
  switchTrackOff: "#cbd5e1",
  danger: "#dc2626",
  warningBg: "#fffbeb",
  warningBorder: "#fcd34d",
  warningIconBg: "#fef3c7",
  warningIcon: "#b45309",
  warningText: "#78350f",
  warningSub: "#92400e",
};

const dark = {
  bg: "#0f172a",
  cardBg: "#1e293b",
  text: "#f1f5f9",
  muted: "#94a3b8",
  border: "#334155",
  primary: "#3b82f6",
  iconBg: "#334155",
  switchTrackOff: "#475569",
  danger: "#f87171",
  warningBg: "#422006",
  warningBorder: "#a16207",
  warningIconBg: "#713f12",
  warningIcon: "#fbbf24",
  warningText: "#fde68a",
  warningSub: "#fcd34d",
};

/* ── Styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  appName: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginBottom: 4,
  },

  /* Permission banner */
  permissionBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  permissionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionText: {
    flex: 1,
    gap: 2,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  permissionSub: {
    fontSize: 12,
    lineHeight: 16,
  },

  /* Hero toggle */
  heroCard: {
    padding: 22,
    borderRadius: 22,
    borderWidth: 1.5,
    gap: 18,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  heroSwitch: {
    transform: [{ scaleX: 1.15 }, { scaleY: 1.15 }],
  },
  heroText: { gap: 4 },
  heroTitle: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  heroStatus: {
    fontSize: 15,
    fontWeight: "500",
  },

  /* Hero input */
  inputHero: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1.5,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  inputHeroField: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  inputHeroButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 13,
    marginLeft: 4,
    marginTop: -8,
    fontWeight: "500",
  },

  /* Compact list */
  section: { gap: 8, marginTop: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginLeft: 4,
  },
  listCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  rowText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  removeBtn: { padding: 4 },
  divider: { height: StyleSheet.hairlineWidth },
  emptyCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  emptyText: { fontSize: 13 },
});
