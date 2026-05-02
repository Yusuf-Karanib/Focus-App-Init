import React, { useEffect, useMemo, useState } from "react";
import {
  Animated,
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

  // Hydrate from native storage on mount
  useEffect(() => {
    if (!isFocusModuleAvailable) return;
    try {
      const existing = FocusModule.getBlockedApps();
      if (existing.length > 0) setBlockedPackages(existing);
    } catch (e) {
      // Native call failed — keep defaults
    }
  }, []);

  // Sync any change to the blocklist down to native SharedPreferences
  useEffect(() => {
    try {
      FocusModule.setBlockedApps(blockedPackages);
    } catch (e) {
      // No-op fallback already handles this on web/Expo Go
    }
  }, [blockedPackages]);

  const trimmedInput = packageInput.trim().toLowerCase();
  const isValidInput = useMemo(() => PACKAGE_REGEX.test(trimmedInput), [trimmedInput]);
  const isDuplicate = blockedPackages.includes(trimmedInput);

  function handleToggle(value: boolean) {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
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

    if (!trimmedInput) {
      setError("Enter a package name first.");
      return;
    }
    if (!isValidInput) {
      setError('Use a format like "com.instagram.android".');
      return;
    }
    if (isDuplicate) {
      setError("That app is already on the blocklist.");
      return;
    }

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
  const addDisabled = !trimmedInput || !isValidInput || isDuplicate;

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
            paddingTop: topPad + 24,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.appName, { color: c.text }]}>FocusApp</Text>
          <Text style={[styles.tagline, { color: c.muted }]}>
            Block distracting apps during focus sessions
          </Text>
        </View>

        {/* Status card */}
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            onPress={() => handleToggle(!isEnabled)}
            style={[
              styles.card,
              {
                backgroundColor: isEnabled ? c.primaryBg : c.cardBg,
                borderColor: isEnabled ? c.primaryBorder : c.border,
              },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: isEnabled }}
            accessibilityLabel="Focus mode toggle"
          >
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: isEnabled ? c.iconBgActive : c.iconBg },
              ]}
            >
              <Feather
                name={isEnabled ? "shield" : "shield-off"}
                size={28}
                color={isEnabled ? c.primaryIcon : c.muted}
              />
            </View>

            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: c.text }]}>
                {isEnabled ? "Focus mode is ON" : "Focus mode is OFF"}
              </Text>
              <Text style={[styles.cardSub, { color: c.muted }]}>
                {isEnabled
                  ? `Blocking ${blockedPackages.length} app${blockedPackages.length === 1 ? "" : "s"}`
                  : "Tap to start a focus session"}
              </Text>
            </View>

            <Switch
              value={isEnabled}
              onValueChange={handleToggle}
              trackColor={{ false: c.switchTrackOff, true: c.primary }}
              thumbColor="#ffffff"
              ios_backgroundColor={c.switchTrackOff}
              style={styles.switch}
            />
          </Pressable>
        </Animated.View>

        {/* Add to blocklist */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.muted }]}>ADD AN APP</Text>

          <View style={[styles.inputCard, { backgroundColor: c.cardBg, borderColor: c.border }]}>
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
              style={[styles.input, { color: c.text }]}
            />

            <Pressable
              onPress={handleAdd}
              disabled={addDisabled}
              style={({ pressed }) => [
                styles.addButton,
                {
                  backgroundColor: addDisabled ? c.iconBg : c.primary,
                  opacity: pressed && !addDisabled ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add to blocklist"
            >
              <Feather name="plus" size={16} color={addDisabled ? c.muted : "#ffffff"} />
              <Text
                style={[
                  styles.addButtonText,
                  { color: addDisabled ? c.muted : "#ffffff" },
                ]}
              >
                Add to Blocklist
              </Text>
            </Pressable>
          </View>

          {error ? (
            <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
          ) : (
            <Text style={[styles.helperText, { color: c.muted }]}>
              Enter the Android package name (find it on the Play Store URL).
            </Text>
          )}
        </View>

        {/* Blocked apps list */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.muted }]}>
            BLOCKED APPS ({blockedPackages.length})
          </Text>

          {blockedPackages.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: c.cardBg, borderColor: c.border }]}>
              <Feather name="inbox" size={20} color={c.muted} />
              <Text style={[styles.emptyText, { color: c.muted }]}>
                No apps blocked yet. Add one above.
              </Text>
            </View>
          ) : (
            <View style={[styles.listCard, { backgroundColor: c.cardBg, borderColor: c.border }]}>
              {blockedPackages.map((pkg, i) => (
                <View key={pkg}>
                  <View style={styles.row}>
                    <View style={[styles.appIcon, { backgroundColor: c.iconBg }]}>
                      <Feather name="package" size={16} color={c.muted} />
                    </View>
                    <Text
                      style={[styles.appName2, { color: c.text }]}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {pkg}
                    </Text>
                    <View
                      style={[
                        styles.badge,
                        { backgroundColor: isEnabled ? c.primaryBg : c.iconBg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          { color: isEnabled ? c.primaryIcon : c.muted },
                        ]}
                      >
                        {isEnabled ? "Blocked" : "Allowed"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleRemove(pkg)}
                      style={({ pressed }) => [
                        styles.removeBtn,
                        { opacity: pressed ? 0.5 : 1 },
                      ]}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${pkg}`}
                    >
                      <Feather name="x" size={16} color={c.muted} />
                    </Pressable>
                  </View>
                  {i < blockedPackages.length - 1 && (
                    <View style={[styles.divider, { backgroundColor: c.border }]} />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Footer note */}
        <View style={styles.footer}>
          <Feather name="info" size={13} color={c.muted} />
          <Text style={[styles.footerText, { color: c.muted }]}>
            {isFocusModuleAvailable
              ? "Requires Accessibility Service permission on Android"
              : "Native blocking is only active on a built Android APK"}
          </Text>
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
  primary: "#3b82f6",
  primaryBg: "#eff6ff",
  primaryBorder: "#bfdbfe",
  primaryIcon: "#2563eb",
  iconBg: "#f1f5f9",
  iconBgActive: "#dbeafe",
  switchTrackOff: "#cbd5e1",
  danger: "#dc2626",
};

const dark = {
  bg: "#0f172a",
  cardBg: "#1e293b",
  text: "#f1f5f9",
  muted: "#94a3b8",
  border: "#334155",
  primary: "#3b82f6",
  primaryBg: "#1e3a5f",
  primaryBorder: "#1d4ed8",
  primaryIcon: "#60a5fa",
  iconBg: "#334155",
  iconBgActive: "#1e3a5f",
  switchTrackOff: "#475569",
  danger: "#f87171",
};

/* ── Styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    gap: 20,
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  appName: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 14,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardSub: { fontSize: 13 },
  switch: { transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    marginLeft: 4,
  },
  inputCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  input: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(127,127,127,0.08)",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 12,
    marginLeft: 4,
  },
  errorText: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: "500",
  },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyText: {
    fontSize: 13,
    flex: 1,
  },
  listCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  appName2: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  removeBtn: {
    padding: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 4,
  },
  footerText: {
    fontSize: 12,
    textAlign: "center",
  },
});
