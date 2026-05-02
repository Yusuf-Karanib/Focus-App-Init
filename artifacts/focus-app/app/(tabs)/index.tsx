import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { FocusModule, isFocusModuleAvailable } from "../../modules/focus-module";

const DEFAULT_BLOCKED: string[] = [
  "com.instagram.android",
  "com.zhiliaoapp.musically",
  "com.google.android.youtube",
];

const PACKAGE_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

const BG = "#000000";
const FG = "#ffffff";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  const [isEnabled, setIsEnabled] = useState(false);
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

  useEffect(() => {
    checkServiceStatus();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkServiceStatus();
    });
    return () => sub.remove();
  }, [checkServiceStatus]);

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

  function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
    if (Platform.OS !== "web") Haptics.impactAsync(style);
  }

  function handleToggle() {
    tap(
      !isEnabled
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light
    );
    setIsEnabled((v) => !v);
  }

  function handleGrantPermission() {
    tap(Haptics.ImpactFeedbackStyle.Medium);
    try {
      FocusModule.openAccessibilitySettings();
    } catch {
      /* no-op fallback */
    }
  }

  function handleAdd() {
    setError(null);
    if (!trimmedInput) return setError("ENTER A PACKAGE NAME FIRST.");
    if (!isValidInput)
      return setError('USE A FORMAT LIKE "COM.INSTAGRAM.ANDROID".');
    if (isDuplicate) return setError("THAT APP IS ALREADY ON THE BLOCKLIST.");

    setBlockedPackages((prev) => [...prev, trimmedInput]);
    setPackageInput("");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  function handleRemove(pkg: string) {
    setBlockedPackages((prev) => prev.filter((p) => p !== pkg));
    tap();
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.root}
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
        <Text style={styles.appName}>FOCUSAPP</Text>

        <View style={styles.divider} />

        {/* Permission warning — plain text */}
        {!serviceEnabled && (
          <>
            <Text style={styles.warnLabel}>! NO ACCESSIBILITY PERMISSION</Text>
            <Text style={styles.warnBody}>
              REQUIRED TO BLOCK APPS. WITHOUT IT, FOCUS MODE DOES NOTHING.
            </Text>
            <Pressable onPress={handleGrantPermission} hitSlop={10}>
              {({ pressed }) => (
                <Text style={[styles.action, pressed && styles.pressed]}>
                  [ GRANT PERMISSION ]
                </Text>
              )}
            </Pressable>
            <View style={styles.divider} />
          </>
        )}

        {/* Focus Mode — text toggle */}
        <Text style={styles.sectionLabel}>FOCUS MODE</Text>
        <Pressable onPress={handleToggle} hitSlop={10}>
          {({ pressed }) => (
            <Text style={[styles.bigToggle, pressed && styles.pressed]}>
              [ {isEnabled ? "ON " : "OFF"} ]
            </Text>
          )}
        </Pressable>
        <Text style={styles.statusLine}>
          {isEnabled
            ? `BLOCKING ${blockedPackages.length} APP${blockedPackages.length === 1 ? "" : "S"}`
            : "TAP TO START"}
        </Text>

        <View style={styles.divider} />

        {/* Add to blocklist */}
        <Text style={styles.sectionLabel}>ADD PACKAGE</Text>
        <TextInput
          value={packageInput}
          onChangeText={(t) => {
            setPackageInput(t);
            if (error) setError(null);
          }}
          placeholder="com.example.app"
          placeholderTextColor="#666666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          style={styles.input}
          underlineColorAndroid="transparent"
        />
        <Pressable onPress={handleAdd} disabled={addDisabled} hitSlop={10}>
          {({ pressed }) => (
            <Text
              style={[
                styles.action,
                addDisabled && styles.actionDisabled,
                pressed && !addDisabled && styles.pressed,
              ]}
            >
              [ ADD ]
            </Text>
          )}
        </Pressable>
        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.divider} />

        {/* Blocklist — plain text */}
        <Text style={styles.sectionLabel}>
          BLOCKLIST ({blockedPackages.length})
        </Text>
        {blockedPackages.length === 0 ? (
          <Text style={styles.bodyMuted}>NONE.</Text>
        ) : (
          blockedPackages.map((pkg) => (
            <View key={pkg} style={styles.listLine}>
              <Text style={styles.listText} numberOfLines={1} ellipsizeMode="middle">
                {`- ${pkg}`}
              </Text>
              <Pressable onPress={() => handleRemove(pkg)} hitSlop={10}>
                {({ pressed }) => (
                  <Text style={[styles.removeText, pressed && styles.pressed]}>
                    [X]
                  </Text>
                )}
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ── Styles — strictly monochrome, no borders/shadows/rounded corners ───── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: {
    paddingHorizontal: 20,
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
    marginVertical: 16,
  },

  sectionLabel: {
    color: FG,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  bigToggle: {
    color: FG,
    fontFamily: MONO,
    fontSize: 48,
    fontWeight: "900",
    letterSpacing: 2,
    marginVertical: 4,
  },

  statusLine: {
    color: FG,
    fontFamily: MONO,
    fontSize: 13,
    letterSpacing: 1,
    marginTop: 8,
  },

  input: {
    color: FG,
    fontFamily: MONO,
    fontSize: 16,
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: BG,
  },

  action: {
    color: FG,
    fontFamily: MONO,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 12,
  },
  actionDisabled: {
    color: "#555555",
  },
  pressed: {
    color: "#888888",
  },

  errorText: {
    color: BG,
    backgroundColor: FG,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignSelf: "flex-start",
    overflow: "hidden",
  },

  warnLabel: {
    color: BG,
    backgroundColor: FG,
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.5,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignSelf: "flex-start",
    overflow: "hidden",
    marginBottom: 8,
  },
  warnBody: {
    color: FG,
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 0.8,
    lineHeight: 18,
  },

  bodyMuted: {
    color: "#888888",
    fontFamily: MONO,
    fontSize: 14,
    letterSpacing: 1,
  },

  listLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  listText: {
    flex: 1,
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  removeText: {
    color: FG,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 12,
  },
});
