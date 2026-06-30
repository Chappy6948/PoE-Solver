import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api, Arbitrage, Currency, League, TradeStep } from "@/src/api";
import { theme } from "@/src/theme";

export default function Index() {
  const insets = useSafeAreaInsets();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [base, setBase] = useState<string>("exalted");
  const [budget, setBudget] = useState<string>("100");
  const [maxHops, setMaxHops] = useState<2 | 3 | 4>(3);
  const [preset, setPreset] = useState<"conservative" | "balanced" | "aggressive">(
    "balanced"
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Arbitrage[]>([]);
  const [pickLeagueOpen, setPickLeagueOpen] = useState(false);
  const [pickBaseOpen, setPickBaseOpen] = useState(false);
  const [detail, setDetail] = useState<Arbitrage | null>(null);

  // 1. Load leagues, default to current
  useEffect(() => {
    (async () => {
      try {
        const ls = await api.leagues();
        setLeagues(ls);
        const current = ls.find((l) => l.is_current && !l.value.startsWith("HC")) ?? ls[0];
        if (current) setLeague(current.value);
      } catch (e: any) {
        setError(e.message ?? "Failed to load leagues");
      }
    })();
  }, []);

  // 2. Load currencies when league changes
  useEffect(() => {
    if (!league) return;
    (async () => {
      try {
        const cs = await api.currencies(league);
        setCurrencies(cs);
      } catch (e: any) {
        setError(e.message ?? "Failed to load currencies");
      }
    })();
  }, [league]);

  const runArbitrage = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!league) return;
      const b = Math.max(1, parseFloat(budget) || 100);
      if (!opts?.silent) setLoading(true);
      setError(null);
      const presetParams =
        preset === "conservative"
          ? { min_volume: 20000, min_stock: 500, max_profit_pct: 30 }
          : preset === "aggressive"
          ? { min_volume: 500, min_stock: 30, max_profit_pct: 200 }
          : { min_volume: 5000, min_stock: 300, max_profit_pct: 50 };
      try {
        const res = await api.arbitrage({
          league,
          base,
          budget: b,
          max_hops: maxHops,
          ...presetParams,
        });
        // multi_hop contains 3-4 hop cycles; direct is always empty by design
        setOpportunities(res.multi_hop);
      } catch (e: any) {
        setError(e.message ?? "Failed to find arbitrage");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [league, base, budget, maxHops, preset]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    runArbitrage({ silent: true });
  }, [runArbitrage]);

  const items = opportunities;
  const currencyMap = useMemo(() => {
    const m = new Map<string, Currency>();
    currencies.forEach((c) => m.set(c.api_id, c));
    return m;
  }, [currencies]);
  const baseCurrency = currencyMap.get(base);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: theme.colors.bg }}>
        <Header />
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <FlatList
          testID="arbitrage-list"
          data={items}
          keyExtractor={(_, i) => `opp-${i}`}
          contentContainerStyle={{
            paddingBottom: insets.bottom + theme.spacing.xl,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.gold}
            />
          }
          ListHeaderComponent={
            <View>
              <ControlPanel
                league={league}
                onPickLeague={() => setPickLeagueOpen(true)}
                base={baseCurrency}
                onPickBase={() => setPickBaseOpen(true)}
                budget={budget}
                onBudget={setBudget}
                maxHops={maxHops}
                onMaxHops={setMaxHops}
                preset={preset}
                onPreset={setPreset}
                onSearch={() => runArbitrage()}
                loading={loading}
              />
              <ResultsHeader count={opportunities.length} />
              {error && (
                <View style={styles.errorBox} testID="error-box">
                  <Ionicons name="warning" size={16} color={theme.colors.crimsonGlow} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
              {loading && (
                <View style={styles.loadingBox} testID="loading-indicator">
                  <ActivityIndicator color={theme.colors.gold} />
                  <Text style={styles.loadingText}>Scanning exchange…</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <EmptyState />
            ) : null
          }
          renderItem={({ item, index }) => (
            <OpportunityCard
              opp={item}
              rank={index + 1}
              onPress={() => setDetail(item)}
            />
          )}
        />
      </KeyboardAvoidingView>

      <PickerModal
        testID="league-picker"
        open={pickLeagueOpen}
        onClose={() => setPickLeagueOpen(false)}
        title="Choose League"
        options={leagues.map((l) => ({
          id: l.value,
          label: l.value,
          subtitle: l.is_current ? "Live" : undefined,
        }))}
        selected={league}
        onSelect={(v) => {
          setLeague(v);
          setPickLeagueOpen(false);
        }}
      />
      <PickerModal
        testID="base-picker"
        open={pickBaseOpen}
        onClose={() => setPickBaseOpen(false)}
        title="Investment Currency"
        options={currencies.slice(0, 60).map((c) => ({
          id: c.api_id,
          label: c.text,
          subtitle: c.category,
          icon: c.icon_url ?? undefined,
        }))}
        selected={base}
        onSelect={(v) => {
          setBase(v);
          setPickBaseOpen(false);
        }}
      />
      <DetailModal opp={detail} onClose={() => setDetail(null)} base={baseCurrency} />
    </View>
  );
}

// ---------------- Header ----------------
function Header() {
  return (
    <LinearGradient
      colors={["#1a0d0d", "#0a0a0d"]}
      style={styles.header}
      testID="app-header"
    >
      <View style={styles.headerInner}>
        <MaterialCommunityIcons name="treasure-chest" size={28} color={theme.colors.gold} />
        <View style={{ marginLeft: theme.spacing.sm }}>
          <Text style={styles.headerTitle}>RuneTrader</Text>
          <Text style={styles.headerSubtitle}>PoE 2 Arbitrage · poe2scout</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

// ---------------- Control Panel ----------------
function ControlPanel({
  league,
  onPickLeague,
  base,
  onPickBase,
  budget,
  onBudget,
  maxHops,
  onMaxHops,
  preset,
  onPreset,
  onSearch,
  loading,
}: {
  league: string | null;
  onPickLeague: () => void;
  base?: Currency;
  onPickBase: () => void;
  budget: string;
  onBudget: (v: string) => void;
  maxHops: 2 | 3 | 4;
  onMaxHops: (v: 2 | 3 | 4) => void;
  preset: "conservative" | "balanced" | "aggressive";
  onPreset: (p: "conservative" | "balanced" | "aggressive") => void;
  onSearch: () => void;
  loading: boolean;
}) {
  return (
    <View style={styles.controlWrap}>
      <View style={styles.controlGrid}>
        <Pressable
          testID="league-select"
          onPress={onPickLeague}
          style={[styles.field, { flex: 1 }]}
        >
          <Text style={styles.fieldLabel}>LEAGUE</Text>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldValue} numberOfLines={1}>
              {league ?? "Loading…"}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.colors.gold} />
          </View>
        </Pressable>
      </View>

      <View style={styles.controlGrid}>
        <Pressable
          testID="base-select"
          onPress={onPickBase}
          style={[styles.field, { flex: 1.3 }]}
        >
          <Text style={styles.fieldLabel}>YOU HAVE</Text>
          <View style={styles.fieldRow}>
            {base?.icon_url && (
              <Image
                source={base.icon_url}
                style={styles.coin}
                contentFit="contain"
              />
            )}
            <Text style={styles.fieldValue} numberOfLines={1}>
              {base?.text ?? "Exalted Orb"}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.colors.gold} />
          </View>
        </Pressable>

        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>BUDGET</Text>
          <TextInput
            testID="budget-input"
            value={budget}
            onChangeText={onBudget}
            keyboardType="numeric"
            placeholder="100"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.budgetInput}
          />
        </View>
      </View>

      <View style={styles.hopsRow}>
        <Text style={styles.hopsLabel}>HOPS</Text>
        <View style={styles.hopsChips}>
          {([2, 3, 4] as const).map((h) => (
            <Pressable
              key={h}
              testID={`hops-chip-${h}`}
              onPress={() => onMaxHops(h)}
              style={[styles.hopChip, maxHops === h && styles.hopChipActive]}
            >
              <Text
                style={[styles.hopChipText, maxHops === h && styles.hopChipTextActive]}
              >
                {h}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingVertical: 2 }}
        style={{ marginTop: 4 }}
      >
        {([
          { id: "conservative", label: "Conservative", icon: "shield-check" },
          { id: "balanced", label: "Balanced", icon: "scale-balance" },
          { id: "aggressive", label: "Aggressive", icon: "fire" },
        ] as const).map((p) => {
          const active = preset === p.id;
          return (
            <Pressable
              key={p.id}
              testID={`preset-${p.id}`}
              onPress={() => onPreset(p.id)}
              style={[styles.presetChip, active && styles.presetChipActive]}
            >
              <MaterialCommunityIcons
                name={p.icon as any}
                size={14}
                color={active ? theme.colors.gold : theme.colors.textDim}
              />
              <Text
                style={[
                  styles.presetChipText,
                  active && { color: theme.colors.gold },
                ]}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        testID="find-arbitrage-button"
        onPress={onSearch}
        disabled={loading}
        style={({ pressed }) => [
          styles.searchBtn,
          (pressed || loading) && { opacity: 0.7 },
        ]}
      >
        <LinearGradient
          colors={[theme.colors.gold, "#a87f2a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.searchBtnGrad}
        >
          <MaterialCommunityIcons name="sword-cross" size={18} color="#1a0a0a" />
          <Text style={styles.searchBtnText}>
            {loading ? "SCANNING…" : "HUNT ARBITRAGE"}
          </Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// ---------------- Results Header ----------------
function ResultsHeader({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <View style={styles.resultsHeader} testID="results-header">
      <MaterialCommunityIcons name="lightning-bolt" size={14} color={theme.colors.gold} />
      <Text style={styles.resultsHeaderText}>
        {count} opportunit{count === 1 ? "y" : "ies"} found
      </Text>
      <Text style={styles.resultsHeaderHint}>· sorted by profit %</Text>
    </View>
  );
}

// ---------------- Opportunity Card ----------------
function OpportunityCard({
  opp,
  rank,
  onPress,
}: {
  opp: Arbitrage;
  rank: number;
  onPress: () => void;
}) {
  const profit = opp.end_qty - opp.start_qty;
  const iconList = opp.steps.flatMap((s, i) => (i === 0 ? [s.from_icon, s.to_icon] : [s.to_icon]));
  return (
    <Pressable
      testID={`opportunity-card-${rank}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.cardTop}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>#{rank}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: theme.spacing.sm }}>
          <Text style={styles.cardCycle} numberOfLines={1}>
            {opp.cycle.join(" → ")}
          </Text>
          <Text style={styles.cardHops}>{opp.hops} trade{opp.hops > 1 ? "s" : ""}</Text>
        </View>
        <View style={styles.profitWrap}>
          <Text style={styles.profitPct}>+{opp.profit_pct.toFixed(1)}%</Text>
          <Text style={styles.profitAbs}>
            +{profit.toFixed(2)}
          </Text>
        </View>
      </View>

      <View style={styles.cardIcons}>
        {iconList.map((url, i) => (
          <View key={i} style={styles.iconChainItem}>
            {url ? (
              <Image source={url} style={styles.iconCoin} contentFit="contain" />
            ) : (
              <View style={[styles.iconCoin, { backgroundColor: theme.colors.border }]} />
            )}
            {i < iconList.length - 1 && (
              <Ionicons
                name="arrow-forward"
                size={11}
                color={theme.colors.gold}
                style={{ marginHorizontal: 2 }}
              />
            )}
          </View>
        ))}
      </View>

      <View style={styles.cardBottom}>
        <View style={styles.metaItem}>
          <MaterialCommunityIcons name="cube-outline" size={12} color={theme.colors.textDim} />
          <Text style={styles.metaText}>
            Stock {Math.round(opp.liquidity_score)}
          </Text>
        </View>
        <Text style={styles.metaCta}>Tap for steps →</Text>
      </View>
    </Pressable>
  );
}

// ---------------- Detail Modal ----------------
function DetailModal({
  opp,
  onClose,
  base,
}: {
  opp: Arbitrage | null;
  onClose: () => void;
  base?: Currency;
}) {
  return (
    <Modal
      visible={!!opp}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <SafeAreaView edges={["bottom"]} style={{ width: "100%" }}>
            {opp && (
              <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.lg }}>
                <View style={styles.detailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle} numberOfLines={2}>
                      {opp.cycle.join(" → ")}
                    </Text>
                    <Text style={styles.detailSub}>
                      {opp.hops} trades · liquidity {Math.round(opp.liquidity_score)}
                    </Text>
                  </View>
                  <Pressable
                    testID="detail-close"
                    onPress={onClose}
                    hitSlop={12}
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={20} color={theme.colors.text} />
                  </Pressable>
                </View>

                <LinearGradient
                  colors={["#1d1208", "#0f0905"]}
                  style={styles.summaryBox}
                >
                  <Text style={styles.summaryProfit}>+{opp.profit_pct.toFixed(2)}%</Text>
                  <Text style={styles.summaryText}>
                    Start: {opp.start_qty.toFixed(2)} {base?.text ?? ""}
                  </Text>
                  <Text style={styles.summaryText}>
                    End: {opp.end_qty.toFixed(2)} {base?.text ?? ""}
                  </Text>
                  <Text style={[styles.summaryText, { color: theme.colors.success }]}>
                    Profit: {(opp.end_qty - opp.start_qty).toFixed(2)} {base?.text ?? ""}
                  </Text>
                </LinearGradient>

                <Text style={styles.stepsHeader}>STEP-BY-STEP</Text>
                {opp.steps.map((s, i) => (
                  <Step key={i} step={s} idx={i} />
                ))}

                <View style={styles.warnBox}>
                  <Ionicons name="information-circle" size={16} color={theme.colors.teal} />
                  <Text style={styles.warnText}>
                    Rates come from poe2scout snapshot data. Actual rates may shift
                    quickly. Place buy orders for the cheaper side first.
                  </Text>
                </View>
              </ScrollView>
            )}
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function Step({ step, idx }: { step: TradeStep; idx: number }) {
  return (
    <View style={styles.stepCard} testID={`step-${idx + 1}`}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{idx + 1}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.stepRow}>
          {step.from_icon && (
            <Image source={step.from_icon} style={styles.stepIcon} contentFit="contain" />
          )}
          <Text style={styles.stepQty}>{step.qty_in.toFixed(2)}</Text>
          <Text style={styles.stepName} numberOfLines={1}>
            {step.from_currency}
          </Text>
        </View>
        <View style={styles.arrowRow}>
          <Ionicons name="arrow-down" size={14} color={theme.colors.gold} />
          <Text style={styles.rateText}>1 = {step.rate.toFixed(4)}</Text>
        </View>
        <View style={styles.stepRow}>
          {step.to_icon && (
            <Image source={step.to_icon} style={styles.stepIcon} contentFit="contain" />
          )}
          <Text style={[styles.stepQty, { color: theme.colors.goldBright }]}>
            {step.qty_out.toFixed(2)}
          </Text>
          <Text style={styles.stepName} numberOfLines={1}>
            {step.to_currency}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------------- Picker Modal ----------------
function PickerModal({
  open,
  onClose,
  title,
  options,
  selected,
  onSelect,
  testID,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: { id: string; label: string; subtitle?: string; icon?: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
  testID?: string;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { maxHeight: "75%" }]} testID={testID}>
          <SafeAreaView edges={["bottom"]} style={{ width: "100%" }}>
            <View style={styles.pickerHeader}>
              <Text style={styles.detailTitle}>{title}</Text>
              <Pressable
                testID="picker-close"
                onPress={onClose}
                hitSlop={12}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={20} color={theme.colors.text} />
              </Pressable>
            </View>
            <FlatList
              data={options}
              keyExtractor={(o) => o.id}
              renderItem={({ item }) => {
                const active = item.id === selected;
                return (
                  <Pressable
                    testID={`picker-option-${item.id}`}
                    onPress={() => onSelect(item.id)}
                    style={[styles.pickerItem, active && styles.pickerItemActive]}
                  >
                    {item.icon && (
                      <Image source={item.icon} style={styles.coin} contentFit="contain" />
                    )}
                    <View style={{ flex: 1, marginLeft: theme.spacing.sm }}>
                      <Text style={styles.pickerLabel}>{item.label}</Text>
                      {item.subtitle && (
                        <Text style={styles.pickerSub}>{item.subtitle}</Text>
                      )}
                    </View>
                    {active && (
                      <Ionicons name="checkmark" size={18} color={theme.colors.gold} />
                    )}
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------- Empty State ----------------
function EmptyState() {
  return (
    <View style={styles.empty} testID="empty-state">
      <MaterialCommunityIcons
        name="crystal-ball"
        size={48}
        color={theme.colors.textMuted}
      />
      <Text style={styles.emptyTitle}>Ready to Trade</Text>
      <Text style={styles.emptyText}>
        Tap “Hunt Arbitrage” to scan poe2scout exchange for profitable cycles
        starting from your chosen currency.
      </Text>
    </View>
  );
}

// ---------------- Styles ----------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },

  header: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  headerTitle: {
    color: theme.colors.gold,
    fontSize: theme.font.h1,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  headerSubtitle: {
    color: theme.colors.textDim,
    fontSize: theme.font.small,
  },

  controlWrap: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  controlGrid: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  field: {
    backgroundColor: theme.colors.bgCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
  },
  fieldLabel: {
    color: theme.colors.textDim,
    fontSize: theme.font.micro,
    letterSpacing: 1.2,
    fontWeight: "700",
    marginBottom: 4,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  fieldValue: {
    color: theme.colors.text,
    fontSize: theme.font.body,
    fontWeight: "600",
    flex: 1,
  },
  budgetInput: {
    color: theme.colors.goldBright,
    fontSize: theme.font.h2,
    fontWeight: "700",
    padding: 0,
    margin: 0,
  },
  coin: { width: 18, height: 18 },

  hopsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.xs,
    marginTop: 4,
  },
  hopsLabel: {
    color: theme.colors.textDim,
    fontSize: theme.font.micro,
    letterSpacing: 1.2,
    fontWeight: "700",
    marginRight: theme.spacing.sm,
  },
  hopsChips: { flexDirection: "row", gap: 6 },
  hopChip: {
    backgroundColor: theme.colors.bgCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  hopChipActive: {
    backgroundColor: "#3a2812",
    borderColor: theme.colors.gold,
  },
  hopChipText: {
    color: theme.colors.textDim,
    fontWeight: "700",
    fontSize: theme.font.small,
  },
  hopChipTextActive: { color: theme.colors.gold },

  presetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexShrink: 0,
  },
  presetChipActive: {
    borderColor: theme.colors.gold,
    backgroundColor: "#2a1d0a",
  },
  presetChipText: {
    color: theme.colors.textDim,
    fontWeight: "700",
    fontSize: theme.font.small,
  },

  searchBtn: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.md,
    overflow: "hidden",
  },
  searchBtnGrad: {
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  searchBtnText: {
    color: "#1a0a0a",
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: theme.font.body,
  },

  tabBar: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 6,
  },
  tabItemActive: {
    borderColor: theme.colors.gold,
    backgroundColor: "#2a1d0a",
  },
  tabText: {
    color: theme.colors.textDim,
    fontWeight: "700",
    fontSize: theme.font.small,
    letterSpacing: 0.8,
  },
  tabTextActive: { color: theme.colors.gold },
  tabBadge: {
    backgroundColor: theme.colors.border,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
  },
  tabBadgeActive: { backgroundColor: theme.colors.gold },
  tabBadgeText: { color: theme.colors.textDim, fontSize: theme.font.micro, fontWeight: "700" },
  tabBadgeTextActive: { color: "#1a0a0a" },

  resultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: 4,
    gap: 6,
  },
  resultsHeaderText: {
    color: theme.colors.text,
    fontSize: theme.font.small,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  resultsHeaderHint: {
    color: theme.colors.textDim,
    fontSize: theme.font.micro,
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#3a1414",
    borderColor: theme.colors.crimson,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  errorText: { color: theme.colors.crimsonGlow, fontSize: theme.font.small, flex: 1 },

  loadingBox: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    paddingVertical: theme.spacing.lg,
  },
  loadingText: { color: theme.colors.textDim, fontSize: theme.font.body },

  empty: {
    paddingTop: theme.spacing.xxl,
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  emptyTitle: {
    color: theme.colors.gold,
    fontSize: theme.font.h2,
    fontWeight: "800",
    marginTop: theme.spacing.md,
    letterSpacing: 1,
  },
  emptyText: {
    color: theme.colors.textDim,
    fontSize: theme.font.body,
    textAlign: "center",
    marginTop: theme.spacing.sm,
    lineHeight: 20,
  },

  card: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  cardTop: { flexDirection: "row", alignItems: "center" },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#2a1d0a",
    borderWidth: 1,
    borderColor: theme.colors.borderGold,
    justifyContent: "center",
    alignItems: "center",
  },
  rankText: { color: theme.colors.gold, fontWeight: "800", fontSize: theme.font.small },
  cardCycle: { color: theme.colors.text, fontWeight: "700", fontSize: theme.font.body },
  cardHops: { color: theme.colors.textDim, fontSize: theme.font.micro, marginTop: 2 },
  profitWrap: { alignItems: "flex-end" },
  profitPct: { color: theme.colors.success, fontWeight: "800", fontSize: theme.font.h2 },
  profitAbs: { color: theme.colors.textDim, fontSize: theme.font.micro },

  cardIcons: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: theme.spacing.sm,
    gap: 2,
  },
  iconChainItem: { flexDirection: "row", alignItems: "center" },
  iconCoin: { width: 22, height: 22, borderRadius: 4 },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: theme.colors.textDim, fontSize: theme.font.micro },
  metaCta: { color: theme.colors.gold, fontSize: theme.font.micro, fontWeight: "700" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: theme.colors.bgElev,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    maxHeight: "92%",
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: theme.spacing.sm,
  },
  detailTitle: {
    color: theme.colors.gold,
    fontSize: theme.font.h2,
    fontWeight: "800",
    flex: 1,
  },
  detailSub: {
    color: theme.colors.textDim,
    fontSize: theme.font.small,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.bgCard,
    justifyContent: "center",
    alignItems: "center",
  },
  summaryBox: {
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.borderGold,
    marginBottom: theme.spacing.md,
  },
  summaryProfit: {
    color: theme.colors.goldBright,
    fontSize: theme.font.title,
    fontWeight: "900",
  },
  summaryText: { color: theme.colors.text, fontSize: theme.font.body, marginTop: 2 },

  stepsHeader: {
    color: theme.colors.textDim,
    fontSize: theme.font.micro,
    letterSpacing: 1.5,
    fontWeight: "800",
    marginBottom: theme.spacing.sm,
  },
  stepCard: {
    flexDirection: "row",
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.gold,
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumText: { color: "#1a0a0a", fontWeight: "900" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepIcon: { width: 24, height: 24 },
  stepQty: { color: theme.colors.text, fontWeight: "800", fontSize: theme.font.h2 },
  stepName: { color: theme.colors.textDim, fontSize: theme.font.body, flex: 1 },
  arrowRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 32,
    marginVertical: 2,
    gap: 6,
  },
  rateText: { color: theme.colors.textDim, fontSize: theme.font.small },

  warnBox: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#0e2426",
    borderColor: "#1d4748",
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  warnText: { color: theme.colors.teal, fontSize: theme.font.small, flex: 1 },

  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.md,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radius.md,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pickerItemActive: { borderColor: theme.colors.gold },
  pickerLabel: { color: theme.colors.text, fontSize: theme.font.body, fontWeight: "700" },
  pickerSub: { color: theme.colors.textDim, fontSize: theme.font.small, marginTop: 2 },
});
