import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, GestureResponderEvent, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Activity, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Bell, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, ClipboardList, Fingerprint, Flag, LayoutGrid, LocateFixed, LockKeyhole, LockKeyholeOpen, LogOut, Map, MapPin, Menu, MoreHorizontal, Radio, Route, RouteOff, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Wifi, X, Zap } from 'lucide-react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { getBand, getChannel, initialDemoNetworks, signalQuality, WifiNetwork } from './src/wifi';
import { FALLBACK_PRODUCTS, PRODUCT_SEARCH_DEBOUNCE_MS, fetchProducts, StoreProduct } from './src/products';
import { ENTRANCE_POINT, MapPoint, ProductRoute, formatDistance, routeInstruction, routeTurnDirection } from './src/route';
import { EMPTY_SHOPPING_STATE, productForShopper, remainingTripDistance, shoppingReducer, type ShoppingRouteStatus, type ShoppingStop } from './src/shopping-list';
import { callWalkApi, fetchWalkGraph, findWalkEdgeAtPoint, requestWalkRoute, resolveWalkEdges, toProductRoute, type WalkEdge, type WalkGraph } from './src/walk-graph';
import { isShopperPositionFresh, loadShopperPosition, loadShopperPositionAsync, loadShoppingState, loadShoppingStateAsync, saveShoppingState, saveShoppingStateAsync } from './src/shopping-storage';
import { insideStoreWalls, tappedWalkwayPosition } from './src/shopper-location';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANDSCAPE_PLAN, PORTRAIT_PLAN, SHOPPER_HALO_RADIUS, aisleLabelPlacement, entranceTextBox, frameContains, frameCurrentStop, fullMapFrame, labelBoxOf, pinLabelPlacement, startLabelPlacement, startMarkerBox, viewBoxOf, walkEdgeTapBox, type MapFrame } from './src/map-frame';
import { scanNetworks, supportsNativeScan } from './src/scanner';
import { AisleTap, SHELF_LEVELS, SHELF_SIDES, ShelfLevel, ShelfSide, aisleFromTap, aisleTapPoint, shelfLocation, tapToStorePoint } from './src/shelf-location';
import { confirmLocationReport, createLocationReport, fetchLocationReports, fetchReportDecision, LocationReport, rejectLocationReport } from './src/location-reports';
import { StaffLoginThrottledError, StaffSessionInfo, StaffUnauthorizedError, clearStaffSession, clearStaffSessionAsync, formatLoginWait, loadStaffSession, loadStaffSessionAsync, loginStaff, logoutStaff, saveStaffSession, saveStaffSessionAsync, verifyStaffSession } from './src/staff-auth';

/** How often an open list re-checks the store for moved products. */
const STORE_SYNC_INTERVAL_MS = 20000;

const C = { green: '#286347', dark: '#173E2E', lime: '#D6F3B0', text: '#222A27', muted: '#858C88', line: '#E9ECE9', bg: '#F7F9F7', pale: '#EDF4EE' };
type Page = 'Wi-Fi Scanner' | 'Indoor Map' | 'Fingerprints' | 'Scan History' | 'Location reports' | 'Walk paths' | 'Settings';
type ScanRecord = { id: number; time: Date; networks: WifiNetwork[]; demo: boolean };
type Snapshot = { id: number; name: string; zone: string; networks: WifiNetwork[]; time: Date; demo: boolean };
type IconType = typeof Wifi;

/** Pages shoppers must never see; they only exist in the hidden staff area. */
const STAFF_ONLY_PAGES: Page[] = ['Wi-Fi Scanner', 'Fingerprints', 'Scan History', 'Location reports', 'Walk paths', 'Settings'];

/**
 * The staff area is hidden behind the `#staff` URL fragment (e.g.
 * http://localhost:8100/#staff). On native builds there is no URL at all —
 * `window` exists but `window.location` does not — so the fragment is only
 * read when it is really there and staff mode is switched on with
 * EXPO_PUBLIC_STAFF=1 instead.
 */
function staffHash(): string | null {
  if (Platform.OS !== 'web') return null;
  const location = typeof window !== 'undefined' ? window.location : undefined;
  return location && typeof location.hash === 'string' ? location.hash : null;
}

function readStaffMode(): boolean {
  if (process.env.EXPO_PUBLIC_STAFF === '1') return true;
  return staffHash() === '#staff';
}

function Label({ children, style, ...props }: React.ComponentProps<typeof Text>) {
  return <Text {...props} style={[s.text, style]}>{children}</Text>;
}
function IconButton({ icon: Icon, onPress, label, active = false }: { icon: IconType; onPress: () => void; label: string; active?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.iconButton, (hovered || active) && { backgroundColor: C.pale }]}><Icon size={18} color={active ? C.green : '#727B75'} strokeWidth={1.7} /></Pressable>;
}
function Button({ title, onPress, icon: Icon, secondary = false, disabled = false, small = false, label = title }: { title: string; onPress: () => void; icon?: IconType; secondary?: boolean; disabled?: boolean; small?: boolean; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.button, secondary && s.secondaryButton, small && { paddingVertical: 9, paddingHorizontal: 13 }, hovered && { opacity: 0.86 }, disabled && { opacity: 0.55 }]}>{Icon && <Icon size={small ? 15 : 17} color={secondary ? C.text : '#FFF'} strokeWidth={1.8} />}<Label style={[s.buttonText, secondary && { color: C.text }, small && { fontSize: 12 }]}>{title}</Label></Pressable>;
}
function Logo({ small = false }: { small?: boolean }) {
  return <View style={s.row}><View style={[s.logoIcon, small && { width: 30, height: 30 }]}><Svg width={small ? 21 : 27} height={small ? 21 : 27} viewBox="0 0 28 28"><Path d="M14 25s9-7.3 9-14a9 9 0 1 0-18 0c0 6.7 9 14 9 14Z" stroke="#D6F3B0" strokeWidth="1.7" fill="none" /><Circle cx="14" cy="11" r="4" stroke="#D6F3B0" strokeWidth="1.7" fill="none" /><Circle cx="14" cy="11" r="1.3" fill="#D6F3B0" /></Svg></View><Label style={[s.brandName, small && { fontSize: 23 }]}>lis<Label style={{ color: C.green }}>.</Label></Label></View>;
}
function SignalBars({ rssi, size = 20 }: { rssi: number; size?: number }) {
  const count = rssi >= -50 ? 4 : rssi >= -60 ? 3 : rssi >= -70 ? 2 : 1;
  const color = rssi >= -60 ? '#518969' : rssi >= -70 ? '#D3A95E' : '#CF8D6F';
  return <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>{[0, 1, 2, 3].map(i => <View key={i} style={{ width: (size - 6) / 4, height: size * (0.3 + i * 0.23), backgroundColor: i < count ? color : '#E7EBE7', borderRadius: 1.3 }} />)}</View>;
}
function Quality({ rssi }: { rssi: number }) {
  const quality = signalQuality(rssi);
  const color = quality === 'Excellent' || quality === 'Good' ? C.green : quality === 'Fair' ? '#A18039' : '#B47757';
  return <View style={[s.quality, { backgroundColor: quality === 'Excellent' || quality === 'Good' ? '#ECF4EE' : quality === 'Fair' ? '#FBF5E8' : '#FAEEE8' }]}><View style={[s.dot, { backgroundColor: color, width: 5, height: 5 }]} /><Label style={{ color, fontSize: 10.5, fontWeight: '500' }}>{quality}</Label></View>;
}
function StatCard({ title, value, unit, detail, icon: Icon, children }: { title: string; value: string; unit?: string; detail: string; icon: IconType; children?: React.ReactNode }) {
  return <View style={s.statCard}><View style={s.between}><Label style={s.statLabel}>{title}</Label><Icon size={17} color="#839187" strokeWidth={1.6} /></View><View style={[s.row, { alignItems: 'baseline', gap: 5, marginTop: 14 }]}><Label style={s.statValue}>{value}</Label>{unit && <Label style={s.statUnit}>{unit}</Label>}{children}</View><Label style={s.statDetail}>{detail}</Label></View>;
}
function Radar({ networks, scanning }: { networks: WifiNetwork[]; scanning: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: scanning ? 1800 : 16000, useNativeDriver: Platform.OS !== 'web' }));
    animation.start();
    return () => animation.stop();
  }, [spin, scanning]);
  const positions = [[166, 74], [96, 99], [183, 134], [71, 162], [153, 186], [216, 91], [49, 96], [209, 194]];
  return <View style={{ alignItems: 'center', justifyContent: 'center', height: 244, marginTop: 4 }}><Svg width="260" height="244" viewBox="0 0 260 250"><Defs><LinearGradient id="radarGlow" x1="0" y1="1" x2="1" y2="0"><Stop offset="0" stopColor="#DAE9D8" stopOpacity="0.04" /><Stop offset="1" stopColor="#B5DCA6" stopOpacity="0.36" /></LinearGradient></Defs><Circle cx="130" cy="125" r="103" fill="#F9FBF7" />{[27, 52, 78, 103].map(r => <Circle key={r} cx="130" cy="125" r={r} stroke="#E1E9DE" strokeWidth="1" fill="none" />)}<Line x1="27" y1="125" x2="233" y2="125" stroke="#E5ECE2" strokeDasharray="3 4" /><Line x1="130" y1="22" x2="130" y2="228" stroke="#E5ECE2" strokeDasharray="3 4" /><Path d="M130 125 L130 22 A103 103 0 0 1 233 125 Z" fill="url(#radarGlow)" /><Line x1="130" y1="125" x2="207" y2="57" stroke="#B7CFAB" strokeWidth="1" />{networks.slice(0, 8).map((network, i) => <G key={network.bssid}><Circle cx={positions[i][0]} cy={positions[i][1]} r="8" fill={network.rssi >= -67 ? '#6B9567' : '#BCB595'} opacity="0.1" /><Circle cx={positions[i][0]} cy={positions[i][1]} r="3.5" fill={network.rssi >= -67 ? '#719665' : '#B9AD88'} stroke="#FFF" strokeWidth="1.5" /></G>)}<Circle cx="130" cy="125" r="14" fill="#DDEBD8" /><Circle cx="130" cy="125" r="7" fill={C.green} stroke="#FFF" strokeWidth="2.5" /><SvgText x="130" y="151" fontSize="8" fill="#7D8B7B" textAnchor="middle">YOU</SvgText><SvgText x="130" y="14" fontSize="8" fill="#9BA496" textAnchor="middle">N</SvgText></Svg><Animated.View pointerEvents="none" style={{ position: 'absolute', width: 206, height: 206, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}><Svg width="206" height="206"><Line x1="103" y1="103" x2="103" y2="0" stroke="#A4C794" strokeWidth="1" opacity="0.65" /></Svg></Animated.View></View>;
}
function FloorPlan({
  networks,
  selectedProduct = null,
  routeStart = ENTRANCE_POINT,
  plannedRoute,
  reportedPoint = null,
  reportedAisle = null,
  focusFrame = null,
  walkGraph = null,
  showAllWalkways = false,
  centerFit = false,
  svgLabel = 'Store map',
  manualStart = false,
  showShopperLocation = false,
  large = false,
  height,
  showAccessPoints = true,
  portrait = false,
}: {
  networks: WifiNetwork[];
  selectedProduct?: StoreProduct | null;
  routeStart?: MapPoint;
  plannedRoute?: ProductRoute | null;
  reportedPoint?: MapPoint | null;
  reportedAisle?: number | null;
  focusFrame?: MapFrame | null;
  walkGraph?: WalkGraph | null;
  showAllWalkways?: boolean;
  centerFit?: boolean;
  svgLabel?: string;
  manualStart?: boolean;
  showShopperLocation?: boolean;
  large?: boolean;
  height?: number | string;
  showAccessPoints?: boolean;
  portrait?: boolean;
}) {
  const route = plannedRoute ?? null;
  const focused = focusFrame !== null;
  // Portrait phones: the same store plan is drawn rotated into a 330x700
  // viewBox (aisles become horizontal rows), so it fills a tall screen
  // instead of letterboxing the wide 700x330 plan into the top fifth.
  // Landscape coordinates (x, y) become portrait (330 - y, x).
  // A list route on a phone zooms into the current aisle so the names
  // stay readable once the route chrome shrinks the canvas.
  const viewBox = focusFrame ? viewBoxOf(focusFrame) : portrait ? '0 0 330 700' : '0 0 700 330';
  const point = (x: number, y: number): MapPoint => (portrait ? { x: 330 - y, y: x } : { x, y });
  const rectFor = (x: number, y: number, w: number, h: number) =>
    portrait ? { x: 330 - (y + h), y: x, width: h, height: w } : { x, y, width: w, height: h };
  const resolvedEdges = useMemo(() => resolveWalkEdges(walkGraph), [walkGraph]);
  const openEdges = showAllWalkways ? resolvedEdges.filter((edge) => !edge.blocked) : [];
  const blockedEdges = resolvedEdges.filter((edge) => edge.blocked);
  const blockedSegments: [MapPoint, MapPoint][] = blockedEdges.map((edge) => [
    point(edge.from.x, edge.from.y),
    point(edge.to.x, edge.to.y),
  ]);
  const routePoints = route ? route.points.map((p) => point(p.x, p.y)) : [];
  const routePath = routePoints.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x} ${q.y}`).join(' ');
  const start = point(routeStart.x, routeStart.y);
  // Keep the START marker off the entrance label: above it in landscape,
  // beside/above the dot in portrait.
  const startLabel = startLabelPlacement(start, portrait, manualStart);
  const showStart = !focused || (focusFrame !== null && frameContains(focusFrame, startMarkerBox(start, portrait, manualStart)));
  const showEntranceText = !focused || (focusFrame !== null && frameContains(focusFrame, entranceTextBox(portrait)));
  // An aisle name the YOU marker would cover steps aside, so the shopper
  // can still read which aisle they tapped.
  const aisleLabelContext = showShopperLocation && manualStart ? { shopper: start, routePoints } : undefined;
  const pin = selectedProduct ? point(selectedProduct.mapX, selectedProduct.mapY) : null;
  const reported = reportedPoint ? point(reportedPoint.x, reportedPoint.y) : null;
  // The chip picks the side of the pin that leaves the end of the route and closed segments visible.
  const pinLabel = pin && selectedProduct
    ? pinLabelPlacement(pin, portrait, focused, { aisleNumber: selectedProduct.aisleNumber, routePoints, blockedSegments })
    : null;
  // xMidYMin: fit the store plan to the width and hug the top, so the sheet
  // at the bottom never covers the entrance or aisle labels. A close-up
  // is centered so the current aisle fills the phone.
  return (
    <Svg accessibilityLabel={svgLabel} width="100%" height={height ?? (large ? 340 : 250)} viewBox={viewBox} preserveAspectRatio={focused || centerFit ? 'xMidYMid meet' : 'xMidYMin meet'}>
      <Rect {...rectFor(15, 15, 670, 300)} rx="12" fill="#F7F9F4" stroke="#DCE4D8" strokeWidth="2" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        const active = selectedProduct?.aisleNumber === i + 1;
        const picked = reportedAisle === i + 1;
        const x = 55 + i * 77;
        const aisleRect = rectFor(x, 75, 48, 153);
        const lineStart = point(x + 24, 83);
        const lineEnd = point(x + 24, 220);
        const baseLabel = aisleLabelPlacement(i + 1, portrait, focused, aisleLabelContext);
        const label = showAllWalkways && portrait
          ? { ...baseLabel, x: 281, fontSize: 8.5 }
          : baseLabel;
        const showLabel = !focused || active || (focusFrame !== null && frameContains(focusFrame, labelBoxOf(label)));
        return (
          <G key={i}>
            <Rect {...aisleRect} rx="5" fill={picked ? '#F6E7D2' : active ? '#DCECD4' : '#E5EBE0'} stroke={picked ? '#C47B2B' : active ? C.green : 'none'} strokeWidth={picked ? '2' : active ? '1.5' : '0'} />
            <Line x1={lineStart.x} y1={lineStart.y} x2={lineEnd.x} y2={lineEnd.y} stroke={active ? '#8AB07B' : '#D3DCCD'} />
            {showLabel && <SvgText x={label.x} y={label.y} fontSize={label.fontSize} fontWeight={active || focused ? '700' : '400'} fill={active ? C.green : '#89927F'} textAnchor={label.anchor}>AISLE {i + 1}</SvgText>}
          </G>
        );
      })}
      <Rect {...rectFor(235, 279, 220, 35)} fill="#EFF4E9" />
      {showEntranceText && (portrait ? (
        <SvgText x="38" y="345" fontSize="11" fill="#7A8B71" textAnchor="middle" transform="rotate(-90 38 345)">ENTRANCE / CHECKOUT</SvgText>
      ) : (
        <SvgText x="345" y="300" fontSize="10" fill="#7A8B71" textAnchor="middle">ENTRANCE / CHECKOUT</SvgText>
      ))}
      {showAccessPoints && networks.slice(0, 8).map((n, i) => {
        const ap = point([46, 248, 445, 644, 148, 350, 548, 645][i], [50, 50, 50, 50, 270, 270, 270, 155][i]);
        return <G key={n.bssid}><Circle cx={ap.x} cy={ap.y} r="22" fill="#73A35C" opacity="0.08" /><Circle cx={ap.x} cy={ap.y} r="3.5" fill="#7E9E72" opacity="0.6" /></G>;
      })}
      {showAllWalkways && walkGraph && (
        <G>
          {openEdges.map((edge) => {
            const from = point(edge.from.x, edge.from.y);
            const to = point(edge.to.x, edge.to.y);
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            return (
              <G key={`open-walk-${edge.id}`} accessibilityLabel={`Open walkway: ${edge.name}`}>
                <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" opacity="0.88" />
                <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#2E6F4E" strokeWidth="3" strokeLinecap="round" opacity="0.86" />
                <Circle cx={midX} cy={midY} r="3.6" fill="#EEF5EE" stroke="#2E6F4E" strokeWidth="1.5" />
              </G>
            );
          })}
          {walkGraph.nodes.map((node) => {
            const junction = point(node.mapX, node.mapY);
            return <Circle key={`walk-node-${node.id}`} cx={junction.x} cy={junction.y} r="2.8" fill="#FFFFFF" stroke="#68826C" strokeWidth="1.4" />;
          })}
        </G>
      )}
      {blockedEdges.length > 0 && (
        <G>
          {blockedEdges.map((edge) => {
            const from = point(edge.from.x, edge.from.y);
            const to = point(edge.to.x, edge.to.y);
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            return (
              <G key={`closed-walk-${edge.id}`} accessibilityLabel={`Closed walkway: ${edge.name}`}>
                <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#FFFFFF" strokeWidth="7.5" strokeLinecap="round" opacity="0.95" />
                <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#FBE8E4" strokeWidth="5.2" strokeLinecap="round" />
                <Line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#B43E2B" strokeWidth="3.2" strokeDasharray="5 4" strokeLinecap="round" />
                <Circle cx={from.x} cy={from.y} r="2.6" fill="#B43E2B" />
                <Circle cx={to.x} cy={to.y} r="2.6" fill="#B43E2B" />
                <Circle cx={midX} cy={midY} r="6.4" fill="#B43E2B" stroke="#FFFFFF" strokeWidth="1.7" />
                <Line x1={midX - 2.3} y1={midY - 2.3} x2={midX + 2.3} y2={midY + 2.3} stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
                <Line x1={midX + 2.3} y1={midY - 2.3} x2={midX - 2.3} y2={midY + 2.3} stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
              </G>
            );
          })}
        </G>
      )}
      {route && (
        <G>
          <Path d={routePath} stroke="#FFFFFF" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          <Path d={routePath} stroke={C.green} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5" />
        </G>
      )}
      {showShopperLocation && showStart && (
        <G accessibilityLabel={manualStart ? 'Your tapped location' : 'Route start at the entrance'}>
          {manualStart && <Circle cx={start.x} cy={start.y} r={SHOPPER_HALO_RADIUS} fill="#2B6CB0" opacity="0.14" />}
          <Circle cx={start.x} cy={start.y} r="8" fill="#FFFFFF" stroke={manualStart ? '#2163A5' : C.green} strokeWidth="2.5" />
          <Circle cx={start.x} cy={start.y} r="3" fill={manualStart ? '#2163A5' : C.green} />
          <SvgText x={startLabel.x} y={startLabel.y} fontSize={startLabel.fontSize} fontWeight="700" fill={manualStart ? '#2163A5' : C.green} textAnchor={startLabel.anchor}>{manualStart ? 'YOU' : 'START'}</SvgText>
        </G>
      )}
      {selectedProduct && pin && pinLabel && (
        <G>
          <Circle cx={pin.x} cy={pin.y} r="22" fill={C.green} opacity="0.16" />
          <Circle cx={pin.x} cy={pin.y} r="9" fill={C.green} stroke="#FFFFFF" strokeWidth="2.5" />
          <Circle cx={pin.x} cy={pin.y} r="3" fill="#D6F3B0" />
          <Rect x={pinLabel.x - pinLabel.width / 2} y={pinLabel.y - 12} width={pinLabel.width} height="24" rx="6" fill={C.dark} />
          <SvgText x={pinLabel.x} y={pinLabel.y + 4} fontSize={pinLabel.fontSize} fontWeight="600" fill="#FFFFFF" textAnchor="middle">{selectedProduct.name}</SvgText>
        </G>
      )}
      {reported && (
        <G>
          <Circle cx={reported.x} cy={reported.y} r="18" fill="#C47B2B" opacity="0.22" />
          <Circle cx={reported.x} cy={reported.y} r="7" fill="#C47B2B" stroke="#FFFFFF" strokeWidth="2" />
        </G>
      )}
    </Svg>
  );
}

function WalkPathsMap({
  walkGraph,
  networks,
  portrait,
  disabled,
  onToggleEdge,
}: {
  walkGraph: WalkGraph;
  networks: WifiNetwork[];
  portrait: boolean;
  disabled: boolean;
  onToggleEdge: (edge: WalkEdge) => void;
}) {
  const tapSurfaceRef = useRef<View>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const plan = portrait ? PORTRAIT_PLAN : LANDSCAPE_PLAN;
  const fullFrame = fullMapFrame(portrait);
  const resolvedEdges = useMemo(() => resolveWalkEdges(walkGraph), [walkGraph]);
  // Render longer spanning segments first so shorter, specific aisle/corridor
  // segments always sit on top when connections share a corridor or aisle.
  const orderedHitEdges = useMemo(
    () =>
      [...resolvedEdges].sort(
        (a, b) =>
          Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y) -
          Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y),
      ),
    [resolvedEdges],
  );

  function toggleAtLocal(localX: number, localY: number, svgWidth: number, svgHeight: number) {
    if (disabled) return;
    const storePoint = tapToStorePoint({
      localX,
      localY,
      svgWidth,
      svgHeight,
      portrait,
      frame: fullFrame,
    });
    if (!storePoint) return;
    const hit = findWalkEdgeAtPoint(storePoint, walkGraph);
    if (hit) onToggleEdge(hit);
  }

  function handleSurfacePress(event: GestureResponderEvent) {
    const native = event.nativeEvent as GestureResponderEvent['nativeEvent'] & { clientX?: number; clientY?: number };
    const node = event.currentTarget as unknown as { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };
    if (node.getBoundingClientRect && typeof native.clientX === 'number' && typeof native.clientY === 'number') {
      const rect = node.getBoundingClientRect();
      toggleAtLocal(native.clientX - rect.left, native.clientY - rect.top, rect.width, rect.height);
      return;
    }
    const { locationX, locationY } = native;
    if (surfaceSize.width > 0 && surfaceSize.height > 0) {
      toggleAtLocal(locationX, locationY, surfaceSize.width, surfaceSize.height);
      return;
    }
    tapSurfaceRef.current?.measureInWindow((_x, _y, w, h) => {
      toggleAtLocal(locationX, locationY, w, h);
    });
  }

  return (
    <View
      accessibilityLabel="Walk paths map"
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        const nextHeight = event.nativeEvent.layout.height;
        setSurfaceSize((current) =>
          current.width === nextWidth && current.height === nextHeight
            ? current
            : { width: nextWidth, height: nextHeight },
        );
      }}
      style={[
        s.walkMapFrame,
        portrait ? { aspectRatio: 330 / 700, maxWidth: 380 } : { aspectRatio: 700 / 330, maxWidth: 880 },
      ]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <FloorPlan
          networks={networks}
          walkGraph={walkGraph}
          showAllWalkways
          showAccessPoints={false}
          portrait={portrait}
          centerFit
          svgLabel="Walk paths store map"
          height="100%"
        />
      </View>
      <Pressable
        ref={tapSurfaceRef}
        accessible={false}
        focusable={false}
        disabled={disabled}
        onPress={handleSurfacePress}
        style={StyleSheet.absoluteFill}
      />
      {orderedHitEdges.map((edge) => {
        const box = walkEdgeTapBox(edge.from, edge.to, portrait);
        return (
          <Pressable
            key={`walk-hit-${edge.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${edge.blocked ? 'Reopen' : 'Block'} walkway: ${edge.name}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onToggleEdge(edge)}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
              s.walkEdgeHit,
              {
                left: `${(box.x / plan.width) * 100}%`,
                top: `${(box.y / plan.height) * 100}%`,
                width: `${(box.width / plan.width) * 100}%`,
                height: `${(box.height / plan.height) * 100}%`,
              },
              (hovered || pressed) && (edge.blocked ? s.walkEdgeHitBlockedHover : s.walkEdgeHitOpenHover),
            ]}
          />
        );
      })}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      {/* iOS overlays the keyboard; Android already resizes the app window.
          A flex child inside the padding keeps absolute map chrome above it. */}
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding" enabled={Platform.OS === 'ios'}>
        <LisApp />
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

function LisApp() {
  const { width, height: windowHeight } = useWindowDimensions();
  // Notch / Dynamic Island on top, home indicator below. Both are zero in a
  // browser, so the tested web layout is unchanged by these offsets.
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();
  const mobile = width < 760;
  const portrait = windowHeight > width;
  const compact = width < 1160;
  const staffBuild = process.env.EXPO_PUBLIC_STAFF === '1';
  const [staffRequested, setStaffRequested] = useState(readStaffMode);
  const [staffSession, setStaffSession] = useState<StaffSessionInfo | null>(() => loadStaffSession());
  const [staffHydrated, setStaffHydrated] = useState(Platform.OS === 'web');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffSigningIn, setStaffSigningIn] = useState(false);
  const [staffLoginError, setStaffLoginError] = useState('');
  // After repeated wrong passwords the backend makes sign-in wait; the
  // screen shows the remaining time and disables the button until it ends.
  const [staffLoginWaitUntil, setStaffLoginWaitUntil] = useState(0);
  const [loginClock, setLoginClock] = useState(() => Date.now());
  useEffect(() => {
    if (!staffLoginWaitUntil) return undefined;
    const timer = setInterval(() => { setLoginClock(Date.now()); }, 1000);
    return () => clearInterval(timer);
  }, [staffLoginWaitUntil]);
  useEffect(() => {
    if (staffLoginWaitUntil && loginClock >= staffLoginWaitUntil) setStaffLoginWaitUntil(0);
  }, [staffLoginWaitUntil, loginClock]);
  const staffLoginWaitSeconds = staffLoginWaitUntil ? Math.max(0, Math.ceil((staffLoginWaitUntil - loginClock) / 1000)) : 0;
  const passwordInputRef = useRef<TextInput>(null);
  const staffMode = staffRequested && staffSession !== null;
  // Shoppers land on the full-screen store map; signed-in staff land on the scanner.
  const [page, setPage] = useState<Page>(() => (readStaffMode() && loadStaffSession() !== null ? 'Wi-Fi Scanner' : 'Indoor Map'));
  const [demo, setDemo] = useState(!supportsNativeScan);
  const [networks, setNetworks] = useState<WifiNetwork[]>(supportsNativeScan ? [] : initialDemoNetworks);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [band, setBand] = useState('All networks');
  const [sortStrongest, setSortStrongest] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [secureOnly, setSecureOnly] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<WifiNetwork | null>(null);
  const [dialog, setDialog] = useState<'help' | 'notifications' | 'save' | 'workspace' | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [zone, setZone] = useState('Ground floor');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<StoreProduct[]>(FALLBACK_PRODUCTS);
  const [selectedProduct, setSelectedProduct] = useState<StoreProduct | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [shopping, dispatchShopping] = useReducer(shoppingReducer, EMPTY_SHOPPING_STATE, () => loadShoppingState(undefined, openedAt));
  // A phone has no localStorage: the saved list is read from AsyncStorage
  // right after the first render, and nothing is written back before that
  // read finishes so the empty first render cannot wipe it.
  const [hydrated, setHydrated] = useState(Platform.OS === 'web');
  const [mapBox, setMapBox] = useState({ width: 0, height: 0 });
  const [mapScreenHeight, setMapScreenHeight] = useState(0);
  const [sheetMode, setSheetMode] = useState<'search' | 'list'>('search');
  const [reporting, setReporting] = useState(false);
  // "Not here": the map tap only picks the aisle. Side and shelf height
  // cannot be seen on a flat map, so the shopper picks them with buttons.
  const [reportAisle, setReportAisle] = useState<AisleTap | null>(null);
  const [reportSide, setReportSide] = useState<ShelfSide | null>(null);
  const [reportShelf, setReportShelf] = useState<ShelfLevel | null>(null);
  const [mapNotice, setMapNotice] = useState('');
  const [routeChrome, setRouteChrome] = useState({ banner: 0, bar: 0 });
  const [locationPromptHeight, setLocationPromptHeight] = useState(0);
  // Latest full product list from the store, used to refresh saved lists.
  const [catalogue, setCatalogue] = useState<StoreProduct[]>([]);
  const [reportHint, setReportHint] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [locationReports, setLocationReports] = useState<LocationReport[]>([]);
  const [reportsError, setReportsError] = useState('');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportBusyId, setReportBusyId] = useState<number | null>(null);
  const [reportsReload, setReportsReload] = useState(0);
  const mapTapRef = useRef<View>(null);
  const [backendLive, setBackendLive] = useState(false);
  // Manual positioning is the iPhone path and the fallback for a future ESP32
  // board being out of range. Null means the entrance, and any tapped spot is
  // forgotten when a trip ends or finishes or after over an hour away.
  const [manualLocation, setManualLocation] = useState<MapPoint | null>(() => loadShopperPosition(undefined, openedAt));
  const [locationError, setLocationError] = useState('');
  const routeStart = manualLocation ?? ENTRANCE_POINT;
  const lastActiveAtRef = useRef<number>(openedAt);
  const shoppingRef = useRef(shopping);
  const manualLocationRef = useRef(manualLocation);
  const hydratedRef = useRef(hydrated);
  // The store's walkable paths, served by the backend. The graph is polled
  // for changes; every route and shopping order still comes from /walk/route.
  const [walkGraph, setWalkGraph] = useState<WalkGraph | null>(null);
  const [walkLoading, setWalkLoading] = useState(true);
  const [walkError, setWalkError] = useState('');
  const [walkBusy, setWalkBusy] = useState(false);
  const [walkReload, setWalkReload] = useState(0);
  // Pickers for adding a connection in the staff walk-paths editor.
  const [walkFrom, setWalkFrom] = useState<number | null>(null);
  const [walkTo, setWalkTo] = useState<number | null>(null);
  const [walkDeleteEdge, setWalkDeleteEdge] = useState<WalkEdge | null>(null);
  const [walkFilter, setWalkFilter] = useState<'all' | 'blocked'>('all');
  const [walkLastAction, setWalkLastAction] = useState('');
  const [walkRevision, setWalkRevision] = useState(0);
  const [selectedWalkPlan, setSelectedWalkPlan] = useState<{
    productId: number;
    route: ProductRoute | null;
    status: ShoppingRouteStatus;
  } | null>(null);
  const [finderExpanded, setFinderExpanded] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const sheetShownRef = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const lastNativeScan = useRef(0);
  const runScanRef = useRef<() => void>(() => {});
  const shopperReportsRef = useRef(shopping.reports);
  const syncingStore = useRef(false);
  useEffect(() => { shopperReportsRef.current = shopping.reports; }, [shopping.reports]);
  useEffect(() => {
    shoppingRef.current = shopping;
    manualLocationRef.current = manualLocation;
    hydratedRef.current = hydrated;
  }, [shopping, manualLocation, hydrated]);
  useEffect(() => {
    if (shopping.completedCount !== null && manualLocation !== null) {
      setManualLocation(null);
      setLocationError('');
      return;
    }
    if (Platform.OS === 'web') {
      saveShoppingState(shopping, undefined, manualLocation, lastActiveAtRef.current);
      return;
    }
    if (!hydrated) return;
    void saveShoppingStateAsync(shopping, manualLocation, lastActiveAtRef.current);
  }, [shopping, hydrated, manualLocation]);
  useEffect(() => {
    if (hydrated) return undefined;
    let cancelled = false;
    const hydrateAt = Date.now();
    void Promise.all([loadShoppingStateAsync(hydrateAt), loadShopperPositionAsync(hydrateAt)]).then(([saved, position]) => {
      if (cancelled) return;
      lastActiveAtRef.current = hydrateAt;
      dispatchShopping({ type: 'hydrate', state: saved });
      setManualLocation((current) => current ?? position);
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [hydrated]);
  const handleAppOpened = useCallback(() => {
    const now = Date.now();
    const expiredInMemory = !isShopperPositionFresh(lastActiveAtRef.current, now);
    const expiredInStorage =
      Platform.OS === 'web'
      && manualLocationRef.current !== null
      && loadShopperPosition(undefined, now) === null;
    lastActiveAtRef.current = now;
    if (expiredInMemory || expiredInStorage) {
      setManualLocation(null);
      setLocationError('');
      dispatchShopping({ type: 'relocate', position: ENTRANCE_POINT });
      const nextShopping = shoppingReducer(shoppingRef.current, { type: 'relocate', position: ENTRANCE_POINT });
      if (Platform.OS === 'web') {
        saveShoppingState(nextShopping, undefined, null, now);
      } else if (hydratedRef.current) {
        void saveShoppingStateAsync(nextShopping, null, now);
      }
      return;
    }
    if (Platform.OS === 'web') {
      saveShoppingState(shoppingRef.current, undefined, manualLocationRef.current, now);
    } else if (hydratedRef.current) {
      void saveShoppingStateAsync(shoppingRef.current, manualLocationRef.current, now);
    }
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') handleAppOpened();
      };
      const onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) handleAppOpened();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('pageshow', onPageShow);
      return () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('pageshow', onPageShow);
      };
    }
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') handleAppOpened();
    });
    return () => subscription.remove();
  }, [handleAppOpened]);
  const dropExpiredStaffSession = useCallback((message = 'Your staff session expired. Sign in again to continue.') => {
    setStaffSession(null);
    setMenuOpen(false);
    setPage('Indoor Map');
    setStaffLoginError(message);
    if (Platform.OS === 'web') clearStaffSession();
    else void clearStaffSessionAsync();
  }, []);
  useEffect(() => {
    if (staffHydrated) return undefined;
    let cancelled = false;
    void loadStaffSessionAsync().then((saved) => {
      if (cancelled) return;
      if (saved) {
        setStaffSession((current) => current ?? saved);
        if (staffRequested) {
          setPage((current) => (current === 'Indoor Map' ? 'Wi-Fi Scanner' : current));
        }
      }
      setStaffHydrated(true);
    });
    return () => { cancelled = true; };
  }, [staffHydrated, staffRequested]);
  useEffect(() => {
    if (!staffRequested || !staffSession?.token) return undefined;
    let cancelled = false;
    const activeToken = staffSession.token;
    void verifyStaffSession(activeToken, undefined, staffSession.username).then((result) => {
      if (cancelled || !mounted.current) return;
      if (result.status === 'unauthorized') {
        dropExpiredStaffSession();
      } else if (result.status === 'valid' && result.username !== staffSession.username) {
        const updated = { token: activeToken, username: result.username };
        setStaffSession(updated);
        if (Platform.OS === 'web') saveStaffSession(updated);
        else void saveStaffSessionAsync(updated);
      }
    });
    return () => { cancelled = true; };
  }, [staffRequested, staffSession?.token, staffSession?.username, dropExpiredStaffSession]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.title = staffRequested ? 'LIS · Staff' : 'LIS · Store map';
  }, [staffRequested]);
  useEffect(() => {
    // The staff area is toggled by the #staff URL fragment. Native builds
    // have no URL, so there is nothing to listen to there.
    if (Platform.OS !== 'web') return undefined;
    const syncStaffMode = () => {
      const wantsStaff = staffHash() === '#staff';
      setStaffRequested((previous) => {
        if (!previous && wantsStaff) {
          setStaffLoginError('');
          setPage((current) => (current === 'Indoor Map' ? 'Wi-Fi Scanner' : current));
        }
        return wantsStaff;
      });
    };
    window.addEventListener('hashchange', syncStaffMode);
    return () => window.removeEventListener('hashchange', syncStaffMode);
  }, []);
  useEffect(() => {
    // Shoppers and unauthenticated visitors are never left on a staff-only page.
    if (!staffMode && STAFF_ONLY_PAGES.includes(page)) setPage('Indoor Map');
  }, [staffMode, page]);
  useEffect(() => {
    if (!staffMode || !staffSession || page !== 'Location reports') return undefined;
    let cancelled = false;
    setReportsLoading(true);
    setReportsError('');
    fetchLocationReports(staffSession.token)
      .then((items) => { if (!cancelled) setLocationReports(items); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof StaffUnauthorizedError) {
          dropExpiredStaffSession();
          return;
        }
        setReportsError(err instanceof Error ? err.message : 'Could not load location reports.');
      })
      .finally(() => { if (!cancelled) setReportsLoading(false); });
    return () => { cancelled = true; };
  }, [staffMode, staffSession, page, reportsReload, dropExpiredStaffSession]);
  useEffect(() => {
    let cancelled = false;
    // Debounce: wait for a short pause in typing before hitting the backend,
    // instead of firing one request per keystroke.
    const timer = setTimeout(() => {
      fetchProducts(productQuery).then(({ products: items, fromBackend }) => {
        if (cancelled || !mounted.current) return;
        setProducts(items);
        setBackendLive(fromBackend);
        if (!fromBackend) return;
        // Search results are the store's current shelves: refresh the list with them.
        if (!productQuery.trim()) setCatalogue(items);
        dispatchShopping({ type: 'sync', catalogue: items });
      });
    }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [productQuery]);

  // A saved list keeps its own copy of each product, so it must be refreshed
  // from the store: staff may have confirmed a move since it was saved.
  const syncStore = useCallback(async () => {
    if (syncingStore.current) return;
    syncingStore.current = true;
    try {
      const mine = Object.values(shopperReportsRef.current);
      const [graph, decisions, productResult] = await Promise.all([
        fetchWalkGraph(),
        Promise.all(mine.map(report => fetchReportDecision(report.reportId))),
        fetchProducts(''),
      ]);
      const { products: items, fromBackend } = productResult;
      if (graph) {
        // Path polling shares the existing 20-second store sync. React keeps
        // the same object when nothing changed, so only real edits replan.
        setWalkGraph(current => JSON.stringify(current) === JSON.stringify(graph) ? current : graph);
      }
      if (!mounted.current || !fromBackend) return;
      setCatalogue(items);
      const decidedReportIds = mine.filter((_, index) => decisions[index] === 'decided').map(report => report.reportId);
      dispatchShopping({ type: 'sync', catalogue: items, decidedReportIds });
    } finally {
      syncingStore.current = false;
    }
  }, []);
  const hasSavedShopping = shopping.items.length > 0 || shopping.trip !== null || Object.keys(shopping.reports).length > 0 || selectedProduct !== null;
  useEffect(() => {
    if (!hasSavedShopping || page !== 'Indoor Map') return undefined;
    void syncStore();
    const timer = setInterval(() => { void syncStore(); }, STORE_SYNC_INTERVAL_MS);
    if (Platform.OS !== 'web') return () => clearInterval(timer);
    // Coming back to the tab (e.g. after unlocking the phone) refreshes at once.
    const onVisible = () => { if (document.visibilityState === 'visible') void syncStore(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [hasSavedShopping, page, syncStore]);
  useEffect(() => {
    if (hasSavedShopping || page !== 'Indoor Map') return undefined;
    // Even before a shopper picks a product, keep closed-walkway markers on
    // the map fresh on the same 20-second cadence without polling /products.
    const refreshWalkOnly = () => {
      void fetchWalkGraph().then((graph) => {
        if (mounted.current && graph) {
          setWalkGraph((current) => (JSON.stringify(current) === JSON.stringify(graph) ? current : graph));
        }
      });
    };
    const timer = setInterval(refreshWalkOnly, STORE_SYNC_INTERVAL_MS);
    if (Platform.OS !== 'web') return () => clearInterval(timer);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshWalkOnly(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [hasSavedShopping, page]);
  useEffect(() => {
    if (!staffMode || page !== 'Walk paths') return;
    setWalkReload((value) => value + 1);
  }, [staffMode, page]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (!mapNotice) return; const t = setTimeout(() => setMapNotice(''), 6000); return () => clearTimeout(t); }, [mapNotice]);
  useEffect(() => { if (!autoScan || page !== 'Wi-Fi Scanner') return; const t = setInterval(() => { if (AppState.currentState === 'active') runScanRef.current(); }, 35000); return () => clearInterval(t); }, [autoScan, page]);
  async function runScan() {
    if (busy.current) return;
    if (!demo && Date.now() - lastNativeScan.current < 35000) { setError('Please wait 35 seconds between scans to respect Android scan limits.'); return; }
    busy.current = true;
    setScanning(true);
    setError('');
    try {
      if (!demo) lastNativeScan.current = Date.now();
      const result = await scanNetworks(demo);
      if (!mounted.current) return;
      setNetworks(result);
      const time = new Date();
      setLastScan(time);
      setHistory(previous => [{ id: time.getTime(), time, networks: result, demo }, ...previous].slice(0, 50));
      setNotice(`${result.length} nearby networks found. Scan complete.`);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'The scan failed. Please try again.'); }
    finally { busy.current = false; if (mounted.current) setScanning(false); }
  }
  runScanRef.current = runScan;
  const visibleNetworks = useMemo(() => networks.filter(n => (n.ssid.toLowerCase().includes(search.toLowerCase()) || n.bssid.toLowerCase().includes(search.toLowerCase())) && (band === 'All networks' || getBand(n.frequency) === band) && (!secureOnly || n.security !== 'Open')).sort((a, b) => sortStrongest ? b.rssi - a.rssi : a.rssi - b.rssi), [networks, search, band, secureOnly, sortStrongest]);
  const strongest = [...networks].sort((a, b) => b.rssi - a.rssi)[0];
  const connected = networks.find(n => n.connected);
  const average = networks.length ? Math.round(networks.reduce((sum, n) => sum + n.rssi, 0) / networks.length) : null;
  const excellentCount = networks.filter(n => n.rssi >= -60).length;
  const fairCount = networks.filter(n => n.rssi < -60 && n.rssi >= -70).length;
  const weakCount = networks.filter(n => n.rssi < -70).length;
  const navigate = (next: Page) => { setPage(next); setMenuOpen(false); };
  useEffect(() => {
    let cancelled = false;
    setWalkLoading(true);
    fetchWalkGraph()
      .then((graph) => {
        if (!cancelled && mounted.current && graph) {
          setWalkGraph(current => JSON.stringify(current) === JSON.stringify(graph) ? current : graph);
        }
      })
      .finally(() => { if (!cancelled && mounted.current) setWalkLoading(false); });
    return () => { cancelled = true; };
  }, [walkReload]);
  useEffect(() => {
    // Graph edits invalidate every unfinished leg immediately. The effects
    // below request fresh backend routes; no local path is used meanwhile.
    setWalkRevision(value => value + 1);
    dispatchShopping({ type: 'replan' });
    setSelectedWalkPlan(null);
  }, [walkGraph]);
  const changeWalkPaths = useCallback(async (mutate: (token: string) => Promise<void>): Promise<boolean> => {
    const token = staffSession?.token;
    if (!token) return false;
    setWalkBusy(true);
    setWalkError('');
    try {
      await mutate(token);
      setWalkReload((value) => value + 1);
      return true;
    } catch (err) {
      if (err instanceof StaffUnauthorizedError) dropExpiredStaffSession();
      else setWalkError(err instanceof Error ? err.message : 'Could not update the walk paths.');
      return false;
    } finally {
      if (mounted.current) setWalkBusy(false);
    }
  }, [staffSession?.token, dropExpiredStaffSession]);
  async function submitStaffLogin() {
    if (!staffUsername.trim() || !staffPassword || staffSigningIn || staffLoginWaitSeconds > 0) return;
    Keyboard.dismiss();
    setStaffSigningIn(true);
    setStaffLoginError('');
    try {
      const session = await loginStaff(staffUsername, staffPassword);
      if (!mounted.current) return;
      if (Platform.OS === 'web') saveStaffSession(session);
      else void saveStaffSessionAsync(session);
      setStaffSession(session);
      setStaffPassword('');
      setStaffLoginWaitUntil(0);
      setPage('Wi-Fi Scanner');
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof StaffLoginThrottledError) {
        const now = Date.now();
        setLoginClock(now);
        setStaffLoginWaitUntil(now + err.retryAfterSeconds * 1000);
        setStaffLoginError('');
      } else {
        setStaffLoginError(err instanceof Error ? err.message : 'Could not sign in.');
      }
    } finally {
      if (mounted.current) setStaffSigningIn(false);
    }
  }
  function leaveStaffScreen() {
    Keyboard.dismiss();
    setStaffLoginError('');
    setStaffPassword('');
    setStaffRequested(false);
    setPage('Indoor Map');
    if (Platform.OS === 'web') window.location.hash = '';
  }
  function lockStaffArea() {
    const token = staffSession?.token;
    setStaffSession(null);
    setStaffPassword('');
    setStaffLoginError('');
    setMenuOpen(false);
    setPage('Indoor Map');
    if (Platform.OS === 'web') {
      clearStaffSession();
      window.location.hash = '';
      setStaffRequested(false);
    } else {
      void clearStaffSessionAsync();
      setStaffRequested(staffBuild);
    }
    if (token) void logoutStaff(token);
  }
  const trip = shopping.trip;
  const nextStop = trip?.stops[trip.currentIndex];
  // A single searched product also follows the store's latest shelf and
  // this shopper's own undecided report.
  const selectedForShopper = selectedProduct ? productForShopper(selectedProduct, catalogue, shopping.reports) : null;
  const currentProduct = nextStop?.product ?? selectedForShopper;
  const selectedPlanMatches = !!selectedForShopper && selectedWalkPlan?.productId === selectedForShopper.id;
  const selectedRoute = nextStop?.route ?? (selectedPlanMatches ? selectedWalkPlan.route : null);
  const currentRouteStatus: ShoppingRouteStatus = nextStop?.routeStatus
    ?? (selectedForShopper ? (selectedPlanMatches ? selectedWalkPlan.status : 'pending') : 'pending');
  const currentRouteStart = nextStop?.route?.points[0] ?? routeStart;
  const displayedProducts = products.map(item => productForShopper(item, [], shopping.reports));
  const reportedByShopper = currentProduct ? shopping.reports[currentProduct.id] !== undefined : false;
  const reportReady = reportAisle !== null && reportSide !== null && reportShelf !== null;
  const listRouteDistance = trip ? remainingTripDistance(trip) : 0;
  const routeActive = currentProduct !== null;

  // Every unfinished trip leg comes from the backend's Dijkstra planner.
  // The current target stays fixed; later stops are returned in walk order.
  const plannedTripKey = useRef('');
  useEffect(() => {
    if (!trip || !nextStop) return undefined;
    const remaining = trip.stops.slice(trip.currentIndex);
    // trip.start follows the just-found shelf, or the shopper's latest tap.
    // A mid-trip relocation must never jump back to the previous stop.
    const start = trip.start.x === 0 && trip.start.y === 0 ? routeStart : trip.start;
    const key = JSON.stringify({
      start,
      currentIndex: trip.currentIndex,
      products: remaining.map(stop => [stop.product.id, stop.product.mapX, stop.product.mapY]),
      walkRevision,
    });
    if (plannedTripKey.current === key && remaining.every(stop => stop.routeStatus !== 'pending')) {
      return undefined;
    }
    plannedTripKey.current = key;
    let cancelled = false;
    const currentIndex = trip.currentIndex;
    const productIds = remaining.map(stop => stop.product.id);
    void requestWalkRoute(start, remaining.map(stop => stop.product), trip.routeStarted)
      .then(response => {
        if (cancelled || !mounted.current) return;
        const productsById = new globalThis.Map(remaining.map(stop => [stop.product.id, stop.product]));
        const stops: ShoppingStop[] = response.stops.map(stop => {
          const product = productsById.get(stop.productId);
          if (!product) throw new Error('The store returned an unknown product.');
          return {
            product,
            route: stop.route ? toProductRoute(stop.route) : null,
            routeStatus: stop.route ? 'ready' : 'closed',
          };
        });
        dispatchShopping({ type: 'applyRoutePlan', currentIndex, productIds, stops, start });
      })
      .catch(() => {
        if (!cancelled && mounted.current) {
          dispatchShopping({ type: 'routePlanFailed', currentIndex, productIds, start });
        }
      });
    return () => { cancelled = true; };
  }, [trip, nextStop, walkRevision, routeStart]);

  // A single product search uses the same public route endpoint.
  useEffect(() => {
    if (!selectedForShopper || trip) {
      setSelectedWalkPlan(null);
      return undefined;
    }
    const product = selectedForShopper;
    let cancelled = false;
    setSelectedWalkPlan({ productId: product.id, route: null, status: 'pending' });
    void requestWalkRoute(routeStart, [product])
      .then(response => {
        if (cancelled || !mounted.current) return;
        const route = response.stops[0]?.route;
        setSelectedWalkPlan({
          productId: product.id,
          route: route ? toProductRoute(route) : null,
          status: route ? 'ready' : 'closed',
        });
      })
      .catch(() => {
        if (!cancelled && mounted.current) {
          setSelectedWalkPlan({ productId: product.id, route: null, status: 'unavailable' });
        }
      });
    return () => { cancelled = true; };
  }, [selectedForShopper, trip, routeStart, walkRevision]);
  // The map is inset by the measured banner and bar (12 from the screen
  // edge plus an 8 gap); the estimates only cover the first frame.
  const routeBannerSpace = routeChrome.banner > 0 ? routeChrome.banner + 20 : reporting ? (mobile ? 132 : 120) : trip ? (mobile ? 144 : 132) : (mobile ? 118 : 110);
  const routeBarSpace = routeChrome.bar > 0 ? routeChrome.bar + 20 : reporting ? (mobile ? 240 : 220) : trip ? (mobile ? 176 : 126) : (mobile ? 118 : 100);
  const showLocationPrompt = !staffMode && !reporting && !mapNotice && shopping.completedCount === null;
  const locationPromptTop = routeActive ? routeBannerSpace : 72;
  // Reserve the guidance card's space instead of laying it over aisle 7 or
  // the back walkway. The map begins below the measured card on every screen.
  const mapCanvasTop = showLocationPrompt
    ? locationPromptTop + (locationPromptHeight || 54) + 8
    : routeActive ? routeBannerSpace : 0;
  const canvasWidth = mapBox.width > 0 ? mapBox.width : width;
  const canvasHeight = mapBox.height > 0 ? mapBox.height : Math.max(160, windowHeight - routeBannerSpace - routeBarSpace);
  const blockedStoreSegments = useMemo<[MapPoint, MapPoint][]>(
    () => resolveWalkEdges(walkGraph).filter((edge) => edge.blocked).map((edge) => [edge.from, edge.to]),
    [walkGraph],
  );
  const focusFrame = trip && portrait && !reporting && nextStop
    ? frameCurrentStop({
        portrait,
        aisleNumber: nextStop.product.aisleNumber,
        pin: { x: nextStop.product.mapX, y: nextStop.product.mapY },
        routePoints: nextStop.route?.points ?? [],
        blockedSegments: blockedStoreSegments,
        manualStart: manualLocation !== null,
        start: currentRouteStart,
        viewportWidth: canvasWidth,
        viewportHeight: canvasHeight,
      })
    : null;
  const sheetVisible = !routeActive && shopping.completedCount === null &&
    (productQuery.trim().length > 0 || sheetMode === 'list');
  // Keep the sheet below the search box even on a short keyboard viewport.
  // Its results ScrollView gets the remaining space instead of clipping rows.
  const preferredSheetHeight = mobile ? 360 : 420;
  const sheetHeight = mapScreenHeight > 0 ? Math.min(preferredSheetHeight, Math.max(0, mapScreenHeight - 84)) : preferredSheetHeight;
  const sheetPeekHeight = Math.min(sheetHeight, mobile ? 108 : 96);
  useEffect(() => {
    if (!sheetVisible) { sheetShownRef.current = false; return; }
    const target = finderExpanded ? 1 : 0; // 1 = slid up, 0 = peeking
    if (!sheetShownRef.current) sheetAnim.setValue(0); // first show: slide up from below
    sheetShownRef.current = true;
    Animated.timing(sheetAnim, { toValue: target, duration: 240, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [sheetVisible, finderExpanded, sheetAnim]);
  function resetShopperLocation() {
    setManualLocation(null);
    setLocationError('');
  }
  function touchOrExpireActivity(): boolean {
    const now = Date.now();
    const expired =
      !isShopperPositionFresh(lastActiveAtRef.current, now)
      || (Platform.OS === 'web' && manualLocationRef.current !== null && loadShopperPosition(undefined, now) === null);
    lastActiveAtRef.current = now;
    if (!expired) return false;
    resetShopperLocation();
    dispatchShopping({ type: 'relocate', position: ENTRANCE_POINT });
    return true;
  }
  function openShoppingList() {
    touchOrExpireActivity();
    Keyboard.dismiss();
    setProductQuery('');
    setSheetMode('list');
    setFinderExpanded(true);
    dispatchShopping({ type: 'dismissCompletion' });
  }
  function startShoppingRoute() {
    if (!shopping.items.length) return;
    const expired = touchOrExpireActivity();
    Keyboard.dismiss();
    setSelectedProduct(null);
    setProductQuery('');
    setSheetMode('search');
    setFinderExpanded(false);
    dispatchShopping({ type: 'start', position: expired ? ENTRANCE_POINT : routeStart });
  }
  function endRoute() {
    lastActiveAtRef.current = Date.now();
    setSelectedProduct(null);
    setProductQuery('');
    setFinderExpanded(false);
    setSheetMode('search');
    cancelLocationReport();
    setMapNotice('');
    resetShopperLocation();
    dispatchShopping({ type: 'end' });
  }
  function markCurrentStopFound() {
    if (!trip || currentRouteStatus !== 'ready') return;
    lastActiveAtRef.current = Date.now();
    setMapNotice('');
    if (trip.currentIndex + 1 >= trip.stops.length) {
      resetShopperLocation();
    }
    dispatchShopping({ type: 'found' });
  }
  function clearReportChoice() {
    setReportAisle(null);
    setReportSide(null);
    setReportShelf(null);
    setReportHint('');
  }
  function beginLocationReport() {
    touchOrExpireActivity();
    clearReportChoice();
    setReporting(true);
    setMapNotice('');
    setFinderExpanded(false);
  }
  function cancelLocationReport() {
    setReporting(false);
    clearReportChoice();
  }
  function setRouteOrigin(position: MapPoint | null) {
    Keyboard.dismiss();
    lastActiveAtRef.current = Date.now();
    setManualLocation(position);
    setLocationError('');
    dispatchShopping({ type: 'relocate', position: position ?? ENTRANCE_POINT });
  }
  function applyMapTap(localX: number, localY: number, width: number, height: number) {
    const storePoint = tapToStorePoint({ localX, localY, svgWidth: width, svgHeight: height, portrait, frame: focusFrame });
    if (reporting) {
      const tap = storePoint ? aisleFromTap(storePoint) : null;
      if (!tap) {
        // Keep an aisle that was already picked; a stray tap should not undo it.
        setReportHint('That is a walkway. Tap one of the aisles.');
        return;
      }
      setReportAisle(tap);
      setReportHint('');
      return;
    }
    if (!storePoint || !insideStoreWalls(storePoint)) {
      setLocationError('Tap inside the store to set your spot.');
      return;
    }
    if (!walkGraph) {
      setLocationError('Map is still loading. Try again in a moment.');
      return;
    }
    // The shopper cannot see the paths, so any floor tap snaps to the closest
    // open walkway instead of asking them to aim at one.
    const position = tappedWalkwayPosition(storePoint, walkGraph);
    if (!position) {
      setLocationError('All aisles are closed right now. Please ask staff.');
      return;
    }
    // Only the position changes here. The existing backend effect requests a
    // fresh route and shopping order; no path is calculated in the app.
    setRouteOrigin(position);
  }
  function handleMapTap(event: GestureResponderEvent) {
    const native = event.nativeEvent as GestureResponderEvent['nativeEvent'] & { clientX?: number; clientY?: number };
    const node = event.currentTarget as unknown as { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };
    if (node.getBoundingClientRect && typeof native.clientX === 'number' && typeof native.clientY === 'number') {
      const rect = node.getBoundingClientRect();
      applyMapTap(native.clientX - rect.left, native.clientY - rect.top, rect.width, rect.height);
      return;
    }
    mapTapRef.current?.measureInWindow((_x, _y, width, height) => {
      applyMapTap(native.locationX, native.locationY, width, height);
    });
  }
  async function sendLocationReport() {
    if (!currentProduct || !reportAisle || !reportSide || !reportShelf || reportSending) return;
    const choice = { ...reportAisle, side: reportSide, shelf: reportShelf };
    setReportSending(true);
    try {
      const report = await createLocationReport(currentProduct.id, choice);
      const picked = shelfLocation(choice);
      // Route this shopper to where they saw it right away. Everyone else
      // keeps the store's location until staff confirm the move.
      const seenAt = Number.isFinite(report.reportedMapX) && Number.isFinite(report.reportedMapY) && Number.isInteger(report.reportedAisleNumber) && typeof report.reportedAisleLocation === 'string'
        ? { aisleLocation: report.reportedAisleLocation, aisleNumber: report.reportedAisleNumber, mapX: report.reportedMapX, mapY: report.reportedMapY }
        : picked;
      dispatchShopping({ type: 'report', productId: currentProduct.id, reportId: report.id, seenAt });
      setMapNotice('Thanks. Your route is being updated. Staff will check the shelf.');
      cancelLocationReport();
    } catch (error) {
      setReportHint(error instanceof Error ? error.message : 'Could not send the location report.');
    } finally {
      setReportSending(false);
    }
  }
  async function reviewLocationReport(id: number, action: 'confirm' | 'reject') {
    if (!staffSession) {
      dropExpiredStaffSession();
      return;
    }
    setReportBusyId(id);
    setReportsError('');
    try {
      if (action === 'confirm') await confirmLocationReport(id, staffSession.token);
      else await rejectLocationReport(id, staffSession.token);
      setNotice(action === 'confirm' ? 'Product moved to the reported shelf.' : 'Location report rejected.');
      setReportsReload((value) => value + 1);
    } catch (err) {
      if (err instanceof StaffUnauthorizedError) {
        dropExpiredStaffSession();
        return;
      }
      setReportsError(err instanceof Error ? err.message : 'Could not update the report.');
    } finally {
      setReportBusyId(null);
    }
  }
  function changeDemo(value: boolean) {
    setDemo(value); setNetworks(value ? initialDemoNetworks : []); setLastScan(null); setAutoScan(false); setError('');
  }
  function saveSnapshot() {
    if (!snapshotName.trim()) return;
    setSnapshots(old => [{ id: Date.now(), name: snapshotName.trim(), zone, networks: [...networks], time: new Date(), demo }, ...old]);
    setDialog(null); setSnapshotName(''); setNotice('Fingerprint saved to this session.');
  }
  async function exportNetworks(items = networks) {
    const csvCell = (value: string | number) => {
      const text = typeof value === 'string' ? value.replace(/^[=+\-@\t\r\n]/, "'$&") : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = ['SSID,BSSID,RSSI (dBm),Band,Channel,Security,Mode', ...items.map(n => [n.ssid, n.bssid, n.rssi, getBand(n.frequency), getChannel(n.frequency), n.security, demo ? 'Demo' : 'Live'].map(csvCell).join(','))].join('\n');
    try {
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a'); a.href = url; a.download = `lis-networks-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
      } else { await Share.share({ message: csv, title: 'LIS Wi-Fi scan' }); }
      setNotice('Scan data exported.');
    } catch { setError('Could not export the scan. Please try again.'); }
  }
  const bannerDirection = reporting
    ? (reportSide ?? 'straight')
    : currentProduct
      ? routeTurnDirection(currentProduct)
      : 'straight';
  const BannerTurnIcon = bannerDirection === 'left' ? ArrowUpLeft : bannerDirection === 'right' ? ArrowUpRight : ArrowUp;
  const bannerTurnLabel = bannerDirection === 'left' ? 'Turn left' : bannerDirection === 'right' ? 'Turn right' : 'Go straight';
  const staffInitials = staffSession ? staffSession.username.slice(0, 2).toUpperCase() : 'ST';
  const allNavItems: { label: Page; icon: IconType }[] = [{ label: 'Wi-Fi Scanner', icon: Wifi }, { label: 'Indoor Map', icon: Map }, { label: 'Fingerprints', icon: Fingerprint }, { label: 'Scan History', icon: Clock3 }, { label: 'Location reports', icon: Flag }, { label: 'Walk paths', icon: Route }];
  // Walk-paths editor helpers: junction names for every connection end.
  const walkNodes = useMemo(() => walkGraph?.nodes ?? [], [walkGraph]);
  const walkEdges = useMemo(() => walkGraph?.edges ?? [], [walkGraph]);
  const blockedWalkCount = useMemo(() => walkEdges.filter((edge) => edge.blocked).length, [walkEdges]);
  const visibleWalkEdges = useMemo(
    () => (walkFilter === 'blocked' ? walkEdges.filter((edge) => edge.blocked) : walkEdges),
    [walkEdges, walkFilter],
  );
  const sortedWalkNodes = useMemo(
    () => [...walkNodes].sort((a, b) => b.mapY - a.mapY || a.mapX - b.mapX),
    [walkNodes],
  );
  async function toggleWalkEdge(edge: WalkEdge) {
    const nextBlocked = !edge.blocked;
    const done = await changeWalkPaths((token) =>
      callWalkApi(token, `/walk/edges/${edge.id}/blocked`, {
        method: 'POST',
        body: { blocked: nextBlocked },
      }),
    );
    if (done) {
      const verb = nextBlocked ? 'Blocked' : 'Reopened';
      setWalkLastAction(`${verb}: ${edge.name}`);
      setNotice(`${verb} ${edge.name}.`);
    }
  }
  async function addWalkConnection() {
    if (walkFrom === null || walkTo === null || walkFrom === walkTo) return;
    const done = await changeWalkPaths((token) =>
      callWalkApi(token, '/walk/edges', { method: 'POST', body: { fromNodeId: walkFrom, toNodeId: walkTo } }),
    );
    if (done) { setWalkFrom(null); setWalkTo(null); }
  }
  // The sidebar is only rendered in staff mode, so it always shows all pages.
  const navItems = allNavItems;
  // The drawer is rendered in a Modal, outside the padded app shell, so it
  // clears the notch and the home bar itself.
  const sidebar = <ScrollView style={[s.sidebar, mobile && s.mobileSidebar]} contentContainerStyle={[s.sidebarContent, mobile && { paddingTop: 40 + safeTop, paddingBottom: 20 + safeBottom }]}><View style={s.brand}><Logo /><Label style={s.brandTagline}>INDOOR INTELLIGENCE</Label></View><Pressable accessibilityRole="button" onPress={() => { setDialog('workspace'); setMenuOpen(false); }} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.workspace, hovered && { backgroundColor: C.pale }]}><View style={s.workspaceIcon}><LayoutGrid size={17} strokeWidth={1.7} color={C.green} /></View><View style={{ flex: 1 }}><Label style={{ fontSize: 12, fontWeight: '600' }}>Hypermarket</Label><Label style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Main workspace</Label></View><ChevronDown size={14} color={C.muted} /></Pressable><Label style={s.navSection}>WORKSPACE</Label><View style={{ gap: 6 }}>{navItems.map(({ label, icon: Icon }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: page === label }} key={label} onPress={() => navigate(label)} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.navItem, page === label && s.navActive, hovered && page !== label && { backgroundColor: '#F4F6F2' }]}><Icon size={18} strokeWidth={page === label ? 2 : 1.65} color={page === label ? C.green : '#7F8780'} /><Label style={[s.navText, page === label && { color: C.green, fontWeight: '600' }]}>{label}</Label>{page === label && <View style={s.activeDot} />}</Pressable>)}</View><View style={{ flex: 1, minHeight: mobile ? 14 : 70 }} />{!mobile && <View style={s.sidebarPromo}><View style={s.promoIcon}><MapPin size={19} color="#D6F3B0" strokeWidth={1.5} /><View style={s.promoOrbit} /><View style={[s.promoOrbit, { width: 77, height: 77, left: -20, top: -20 }]} /></View><Label style={s.promoTitle}>Every signal tells{ '\n' }a location story.</Label><Label style={s.promoText}>Turn Wi-Fi into a smarter{ '\n' }indoor experience.</Label><Pressable accessibilityRole="button" onPress={() => setDialog('help')} style={s.promoLink}><Label style={{ fontSize: 11, color: '#D6F3B0', fontWeight: '600' }}>Discover LIS</Label><ArrowUpRight size={14} color="#D6F3B0" /></Pressable></View>}<View style={s.sidebarBottom}><Pressable accessibilityRole="button" onPress={() => navigate('Settings')} style={[s.navItem, page === 'Settings' && s.navActive]}><Settings2 size={17} color="#7F8780" strokeWidth={1.7} /><Label style={s.navText}>Settings</Label></Pressable><Pressable accessibilityRole="button" onPress={() => setDialog('help')} style={s.navItem}><CircleHelp size={17} color="#7F8780" strokeWidth={1.7} /><Label style={s.navText}>Help & getting started</Label><ArrowUpRight size={13} color="#9AA197" /></Pressable></View>{staffMode && <View style={s.staffBar}><View style={[s.row, { gap: 6, flex: 1, minWidth: 0 }]}><View style={[s.dot, { backgroundColor: '#B08D3F', width: 5, height: 5 }]} /><Label numberOfLines={1} style={{ fontSize: 10, fontWeight: '600', color: '#8A7440', flexShrink: 1 }}>{`STAFF · ${staffSession?.username ?? ''}`}</Label></View><View style={{ marginLeft: 'auto' }}><IconButton icon={LogOut} label="Lock staff area" onPress={lockStaffArea} /></View></View>}<View style={s.sidebarFooter}><View style={[s.dot, { backgroundColor: '#74A263' }]} /><Label style={{ fontSize: 10, color: '#90998E' }}>LIS v1.0.0</Label><Label style={{ fontSize: 10, color: '#B2B9AE', marginLeft: 'auto' }}>Made for indoors</Label></View></ScrollView>;

  if (staffRequested && !staffMode) {
    return (
      <View style={[s.app, { paddingTop: safeTop, paddingBottom: safeBottom }]}>
        <StatusBar style="dark" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.loginScreen, mobile && { paddingHorizontal: 18, paddingVertical: 24 }]}>
          <View accessibilityLabel="Staff sign in" style={[s.loginCard, mobile && { padding: 22 }]}>
            <Logo />
            <Label style={s.loginTitle}>Staff sign in</Label>
            <Label style={s.loginDescription}>Sign in with your store staff account to open scanner tools and review shelf reports.</Label>
            {!staffHydrated ? (
              <View style={[s.row, { gap: 10, paddingVertical: 24 }]}>
                <ActivityIndicator size="small" color={C.green} />
                <Label style={{ fontSize: 12, color: '#586951' }}>Checking saved staff session…</Label>
              </View>
            ) : (
              <>
                {staffLoginWaitSeconds > 0 ? (
                  <View accessibilityLabel="Sign-in wait" accessibilityLiveRegion="polite" style={[s.errorBanner, { marginTop: 18, marginBottom: 4 }]}>
                    <Clock3 size={18} color="#8E4E2D" />
                    <Label style={{ flex: 1, color: '#7D4224', fontSize: 12, lineHeight: 18 }}>{`Too many failed sign-in attempts. You can try again in ${formatLoginWait(staffLoginWaitSeconds)}.`}</Label>
                  </View>
                ) : staffLoginError ? (
                  <View accessibilityLiveRegion="polite" style={[s.errorBanner, { marginTop: 18, marginBottom: 4 }]}>
                    <CircleHelp size={18} color="#8E4E2D" />
                    <Label style={{ flex: 1, color: '#7D4224', fontSize: 12, lineHeight: 18 }}>{staffLoginError}</Label>
                  </View>
                ) : null}
                <Label style={s.loginFieldLabel}>Username</Label>
                <TextInput
                  accessibilityLabel="Staff username"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                  placeholder="Enter username"
                  placeholderTextColor="#64725D"
                  value={staffUsername}
                  onChangeText={(value) => { setStaffUsername(value); if (staffLoginError) setStaffLoginError(''); }}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  style={s.loginInput}
                />
                <Label style={s.loginFieldLabel}>Password</Label>
                <TextInput
                  ref={passwordInputRef}
                  accessibilityLabel="Staff password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  placeholder="Enter password"
                  placeholderTextColor="#64725D"
                  value={staffPassword}
                  onChangeText={(value) => { setStaffPassword(value); if (staffLoginError) setStaffLoginError(''); }}
                  onSubmitEditing={() => { void submitStaffLogin(); }}
                  style={s.loginInput}
                />
                <View style={s.loginActions}>
                  <Button
                    title={staffLoginWaitSeconds > 0 ? `Try again in ${formatLoginWait(staffLoginWaitSeconds)}` : staffSigningIn ? 'Signing in…' : 'Sign in'}
                    label="Sign in"
                    icon={LockKeyhole}
                    disabled={!staffUsername.trim() || !staffPassword || staffSigningIn || staffLoginWaitSeconds > 0}
                    onPress={() => { void submitStaffLogin(); }}
                  />
                  <Button
                    title="Back to store map"
                    secondary
                    onPress={leaveStaffScreen}
                  />
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  return <View style={[s.app, { paddingTop: safeTop, paddingBottom: safeBottom }]}><StatusBar style="dark" />{staffMode && !mobile && sidebar}<View style={s.main}>{staffMode && <View style={[s.topbar, mobile && { paddingHorizontal: 18 }]}><View style={[s.row, { gap: 13 }]}>{mobile ? <IconButton icon={Menu} label="Open navigation" onPress={() => setMenuOpen(true)} /> : <LayoutGrid size={16} color="#949C95" strokeWidth={1.5} />}<Label style={s.breadcrumb}>Workspace</Label><ChevronRight size={12} color="#B9BDB8" /><Label style={s.breadcrumbCurrent}>{page}</Label></View><View style={[s.row, { gap: mobile ? 8 : 19 }]}>{!compact && <View style={[s.row, { gap: 7 }]}><View style={[s.dot, { backgroundColor: '#7A9E69', width: 5, height: 5 }]} /><Label style={{ fontSize: 11, color: '#7D8879' }}>Let’s make indoors intelligent.</Label></View>}<View style={s.headerDivider} /><IconButton icon={Bell} label="Notifications" onPress={() => setDialog('notifications')} /><Pressable accessibilityRole="button" accessibilityLabel="Workspace profile" onPress={() => setDialog('workspace')} style={s.avatar}><Label style={{ fontSize: 11, color: C.green, fontWeight: '600' }}>{staffInitials}</Label></Pressable></View></View>}
    {page === 'Indoor Map' ? (
      <View style={s.mapScreen} onLayout={(event) => setMapScreenHeight(event.nativeEvent.layout.height)}>
        {/* The map is inset by the banner and the bottom bar, so the whole
            store (every aisle and the pin) stays visible above the chrome. */}
        <View
          onLayout={(event) => {
            const nextWidth = event.nativeEvent.layout.width;
            const nextHeight = event.nativeEvent.layout.height;
            setMapBox((current) => current.width === nextWidth && current.height === nextHeight ? current : { width: nextWidth, height: nextHeight });
          }}
          style={[s.mapCanvas, { top: mapCanvasTop }, routeActive && { bottom: routeBarSpace }]}
        >
          <FloorPlan networks={networks} selectedProduct={currentProduct} routeStart={currentRouteStart} plannedRoute={selectedRoute} reportedPoint={reportAisle ? aisleTapPoint(reportAisle, reportSide) : null} reportedAisle={reportAisle?.aisleNumber ?? null} focusFrame={focusFrame} walkGraph={walkGraph} manualStart={manualLocation !== null} showShopperLocation={shopping.completedCount === null} height="100%" showAccessPoints={staffMode} portrait={portrait} />
          {!staffMode && (
            <Pressable
              ref={mapTapRef}
              accessibilityRole="button"
              accessibilityLabel={reporting ? 'Tap the aisle where you saw this product' : 'Set your location on the store map'}
              onPress={handleMapTap}
              style={s.mapTapOverlay}
            />
          )}
        </View>
        {routeActive && currentProduct ? (
          /* Waze-style next-step banner: replaces the search box while routing. */
          <View accessibilityLabel="Route banner" onLayout={(event) => { const next = event.nativeEvent.layout.height; setRouteChrome((current) => current.banner === next ? current : { ...current, banner: next }); }} style={s.routeBanner}>
            <View accessibilityLabel={currentRouteStatus === 'closed' && !reporting ? 'Walkway closed' : bannerTurnLabel} style={s.routeTurnIcon}>{currentRouteStatus === 'closed' && !reporting ? <RouteOff size={22} color="#9A5A2E" strokeWidth={2.4} /> : <BannerTurnIcon size={22} color={C.dark} strokeWidth={2.6} />}</View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {reporting ? (
                <>
                  <Label numberOfLines={1} style={s.routeBannerSub}>{currentProduct.name} is not here</Label>
                  <Label style={[s.routeInstruction, mobile && { fontSize: 18, lineHeight: 23 }]}>{!reportAisle ? 'Tap the aisle where you saw it' : reportSide && reportShelf ? shelfLocation({ ...reportAisle, side: reportSide, shelf: reportShelf }).aisleLocation : `Aisle ${reportAisle.aisleNumber}`}</Label>
                  <Label accessibilityLiveRegion="polite" style={s.routeBannerSub}>{reportHint || (!reportAisle ? 'Tap anywhere on the aisle.' : !reportSide ? 'Now pick the side below.' : !reportShelf ? 'Now pick the shelf below.' : 'Send it for staff to check.')}</Label>
                </>
              ) : (
                <>
                  {trip && <Label style={s.routeBannerSub}>Stop {trip.currentIndex + 1} of {trip.stops.length} · {currentProduct.name}</Label>}
                  <Label style={[s.routeInstruction, mobile && { fontSize: 18, lineHeight: 23 }]}>{currentRouteStatus === 'closed' ? `Aisle ${currentProduct.aisleNumber} is closed right now` : currentRouteStatus === 'pending' ? 'Finding the shortest walk…' : currentRouteStatus === 'unavailable' ? 'Route unavailable right now' : routeInstruction(currentProduct)}</Label>
                  <Label style={s.routeBannerSub}>{currentRouteStatus === 'closed' ? `No open walkway reaches ${currentProduct.name}. Please check again shortly.` : currentRouteStatus === 'pending' ? currentProduct.name : currentRouteStatus === 'unavailable' ? 'Check your connection. Your route will update automatically.' : `${formatDistance(selectedRoute?.distanceMeters ?? 0)} to ${currentProduct.name}`}</Label>
                </>
              )}
            </View>
          </View>
        ) : (
          /* One search box floats on top of the map, Waze-style. */
          <View style={s.mapSearchRow}>
            <View style={s.mapSearchBox}>
              <Search size={17} color="#7F8D75" />
              <TextInput
                accessibilityLabel="Search store products"
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                autoComplete="off"
                returnKeyType="search"
                placeholder="Search products (e.g. Whole Milk, Bread, Coffee)…"
                placeholderTextColor="#9BA493"
                value={productQuery}
                onChangeText={(value) => { touchOrExpireActivity(); setProductQuery(value); setSheetMode('search'); dispatchShopping({ type: 'dismissCompletion' }); if (value.length > 0) setFinderExpanded(true); }}
                onFocus={() => { touchOrExpireActivity(); setSheetMode('search'); setFinderExpanded(true); }}
                style={s.productSearchInput}
              />
              {productQuery.length > 0 && (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear product search" onPress={() => setProductQuery('')}>
                  <X size={14} color={C.muted} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Shopping list (${shopping.items.length} ${shopping.items.length === 1 ? 'item' : 'items'})`}
                onPress={openShoppingList}
                style={s.listToggle}
              >
                <ClipboardList size={19} color={C.green} />
                <Label style={s.listCount}>{shopping.items.length}</Label>
              </Pressable>
              {staffMode && (
                <>
                  <View style={s.searchDivider} />
                  <View style={s.livePill}><View style={[s.dot, { width: 4, height: 4, backgroundColor: backendLive ? C.green : '#9AA48E' }]} /><Label style={{ fontSize: 8.5, color: '#6D835C', fontWeight: '600' }}>{backendLive ? 'POSTGRES API' : 'SEED DATA'}</Label></View>
                </>
              )}
              {(Platform.OS !== 'web' || staffBuild) && !staffRequested && !staffMode && (
                <>
                  <View style={s.searchDivider} />
                  <IconButton icon={LockKeyhole} label="Open staff sign in" onPress={() => { setStaffLoginError(''); setStaffRequested(true); }} />
                </>
              )}
            </View>
          </View>
        )}
        {staffMode && !routeActive && (
          <View style={s.mapInfoCard}>
            <View style={[s.row, { gap: 7 }]}><MapPin size={14} color={C.green} strokeWidth={1.7} /><Label style={s.mapInfoTitle}>{`Hypermarket · ${zone}`}</Label></View>
            <Label style={s.mapInfoSubtitle}>Illustrative floor plan · access point positions are not measured</Label>
            <View style={{ marginTop: 9 }}><Button small secondary title="View fingerprints" icon={ArrowRight} onPress={() => navigate('Fingerprints')} /></View>
          </View>
        )}
        {showLocationPrompt && (
          <View
            accessibilityLabel="Location setting"
            accessibilityLiveRegion="polite"
            onLayout={(event) => {
              const next = event.nativeEvent.layout.height;
              setLocationPromptHeight((current) => current === next ? current : next);
            }}
            style={[s.locationPrompt, { top: locationPromptTop }]}
          >
            <View style={s.locationPromptIcon}><LocateFixed size={19} color={manualLocation ? '#2163A5' : C.green} strokeWidth={2} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label style={s.locationPromptTitle}>{manualLocation ? 'Starting from your tapped spot' : 'Tap the map to set your location'}</Label>
              <Label style={[s.locationPromptText, locationError ? { color: '#A13F2D' } : null]}>
                {locationError || (manualLocation ? 'Tap anywhere else to move it.' : 'Starting from the entrance for now.')}
              </Label>
            </View>
            {manualLocation && (
              <Pressable accessibilityRole="button" accessibilityLabel="Use entrance as route start" onPress={() => setRouteOrigin(null)} style={s.locationReset}>
                <X size={16} color="#496052" strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        )}
        {/* Search results slide up over the map. */}
        <Animated.View
          accessibilityLabel="Product finder sheet"
          style={[
            s.finderSheet,
            {
              height: sheetHeight,
              transform: [
                {
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [sheetHeight - sheetPeekHeight, 0],
                  }),
                },
              ],
            },
            (!sheetVisible || routeActive) && { display: 'none' },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={finderExpanded ? 'Collapse product finder sheet' : 'Expand product finder sheet'}
            onPress={() => setFinderExpanded(!finderExpanded)}
            style={s.sheetHandlePressable}
          >
            <View style={s.sheetHandle} />
          </Pressable>
          <View style={[s.between, { gap: 8 }]}>
            <Label style={s.cardTitle}>{sheetMode === 'list' ? `Shopping list · ${shopping.items.length} ${shopping.items.length === 1 ? 'item' : 'items'}` : 'Store product finder'}</Label>
            {sheetMode === 'list' && <IconButton icon={X} label="Close shopping list" onPress={() => setSheetMode('search')} />}
          </View>
          {sheetMode === 'list' ? (
            <>
              <Label style={s.listHint}>We’ll group these by aisle and pick the shorter walk. It stays saved on this phone.</Label>
              <ScrollView style={s.resultsScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.productList} accessibilityLabel="Shopping list items">
                {shopping.items.length ? shopping.items.map(item => (
                  <View key={item.id} style={s.productRow}>
                    <View style={s.productPinIcon}><MapPin size={14} color={C.green} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Label numberOfLines={1} style={s.listProductName}>{item.name}</Label>
                      <Label style={s.listHint}>{item.aisleLocation}</Label>
                    </View>
                    <IconButton icon={X} label={`Remove ${item.name} from shopping list`} onPress={() => { touchOrExpireActivity(); dispatchShopping({ type: 'remove', id: item.id }); }} />
                  </View>
                )) : (
                  <View style={{ padding: 18 }}><Label style={s.listHint}>Your list is empty. Search for products and tap + to add them.</Label></View>
                )}
              </ScrollView>
              <View style={s.listFooter}>
                <Button title="Start list route" icon={ArrowRight} disabled={!shopping.items.length} onPress={startShoppingRoute} />
              </View>
            </>
          ) : (
            <ScrollView style={s.resultsScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.productList}>
              {displayedProducts.length ? displayedProducts.map(item => {
                const inList = shopping.items.some(p => p.id === item.id);
                return (
                  <View key={item.id} style={[s.productRow, { paddingVertical: 0 }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Select product ${item.name}, ${item.aisleLocation}`}
                      onPress={() => { touchOrExpireActivity(); Keyboard.dismiss(); setSelectedProduct(item); setFinderExpanded(false); setProductQuery(''); setSheetMode('search'); }}
                      style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.productSelect, hovered && { backgroundColor: '#F4F8F1' }]}
                    >
                      <View style={s.productPinIcon}><MapPin size={14} color={C.green} /></View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Label numberOfLines={1} style={s.listProductName}>{item.name}</Label>
                        <Label numberOfLines={1} style={s.listHint}>{item.aisleLocation}</Label>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={inList ? `${item.name} is in shopping list` : `Add ${item.name} to shopping list`}
                      accessibilityState={{ disabled: inList }}
                      disabled={inList}
                      onPress={() => { touchOrExpireActivity(); dispatchShopping({ type: 'add', product: item }); }}
                      style={[s.addListButton, inList && { backgroundColor: C.pale }]}
                    >
                      {inList ? <Check size={18} color={C.green} /> : <Plus size={18} color={C.green} />}
                    </Pressable>
                  </View>
                );
              }) : (
                <View style={{ padding: 18, alignItems: 'center' }}>
                  <Label style={{ fontSize: 11.5, color: C.muted }}>No products match &ldquo;{productQuery}&rdquo;.</Label>
                </View>
              )}
            </ScrollView>
          )}
        </Animated.View>
        {/* Waze-style bottom bar: distance plus a way out of the route. */}
        {routeActive && currentProduct && (
          <View
            accessibilityLabel="Route progress bar"
            onLayout={(event) => { const next = event.nativeEvent.layout.height; setRouteChrome((current) => current.bar === next ? current : { ...current, bar: next }); }}
            style={[s.routeBar, (reporting || (trip && mobile)) && { flexDirection: 'column', alignItems: 'stretch' }]}
          >
            {reporting ? (
              /* The map tap picked the aisle; side and shelf are picked here. */
              <View style={s.reportPicker}>
                <View accessibilityRole="radiogroup" accessibilityLabel="Side of the aisle" style={s.pickRow}>
                  <Label style={s.pickLabel}>Side</Label>
                  {SHELF_SIDES.map(side => (
                    <Pressable key={side} accessibilityRole="radio" accessibilityLabel={`${side === 'left' ? 'Left' : 'Right'} side`} aria-checked={reportSide === side} accessibilityState={{ checked: reportSide === side }} onPress={() => { setReportSide(side); setReportHint(''); }} style={[s.pickOption, reportSide === side && s.pickOptionSelected]}>
                      <Label style={[s.pickOptionText, reportSide === side && { color: '#FFFFFF' }]}>{side === 'left' ? 'Left' : 'Right'}</Label>
                    </Pressable>
                  ))}
                </View>
                <View accessibilityRole="radiogroup" accessibilityLabel="Shelf height" style={s.pickRow}>
                  <Label style={s.pickLabel}>Shelf</Label>
                  {SHELF_LEVELS.map(shelf => (
                    <Pressable key={shelf} accessibilityRole="radio" accessibilityLabel={`${shelf[0].toUpperCase()}${shelf.slice(1)} shelf`} aria-checked={reportShelf === shelf} accessibilityState={{ checked: reportShelf === shelf }} onPress={() => { setReportShelf(shelf); setReportHint(''); }} style={[s.pickOption, reportShelf === shelf && s.pickOptionSelected]}>
                      <Label style={[s.pickOptionText, reportShelf === shelf && { color: '#FFFFFF' }]}>{`${shelf[0].toUpperCase()}${shelf.slice(1)}`}</Label>
                    </Pressable>
                  ))}
                </View>
                <Label style={s.listHint}>Left and right are as you walk into the aisle from the entrance end.</Label>
                <View style={[s.row, { gap: 8, justifyContent: 'flex-end' }]}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Cancel location report" onPress={cancelLocationReport} style={s.notHereButton}>
                    <Label style={s.notHereText}>Cancel</Label>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Send location report" accessibilityState={{ disabled: !reportReady || reportSending }} disabled={!reportReady || reportSending} onPress={sendLocationReport} style={[s.foundButton, { flex: 1 }, (!reportReady || reportSending) && { opacity: 0.45 }]}>
                    <MapPin size={16} color="#FFFFFF" />
                    <Label style={s.endButtonText}>{reportSending ? 'Sending…' : 'Send report'}</Label>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Label numberOfLines={1} style={s.routeBarAisle}>{currentProduct.aisleLocation}</Label>
                  {reportedByShopper && <Label numberOfLines={1} style={s.reportedNote}>Where you saw it · staff will check</Label>}
                  <Label style={s.routeBarDistance}>{currentRouteStatus === 'closed' ? `Aisle ${currentProduct.aisleNumber} closed · no open walk to this shelf` : currentRouteStatus === 'pending' ? 'Updating your route…' : currentRouteStatus === 'unavailable' ? 'Route unavailable · retrying with store updates' : trip ? `${formatDistance(listRouteDistance)} remaining` : `${formatDistance(selectedRoute?.distanceMeters ?? 0)} ${manualLocation ? 'from your spot' : 'from entrance'}`}</Label>
                </View>
                <View style={[s.row, { gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
                  {trip && (
                    <Pressable accessibilityRole="button" accessibilityLabel="Found it" accessibilityState={{ disabled: currentRouteStatus !== 'ready' }} disabled={currentRouteStatus !== 'ready'} onPress={markCurrentStopFound} style={[s.foundButton, currentRouteStatus !== 'ready' && { opacity: 0.45 }]}>
                      <Check size={18} color="#FFFFFF" />
                      <Label style={s.endButtonText}>Found it</Label>
                    </Pressable>
                  )}
                  <Pressable accessibilityRole="button" accessibilityLabel="Not here" onPress={beginLocationReport} style={s.notHereButton}>
                    <Label style={s.notHereText}>Not here</Label>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="End route"
                    onPress={endRoute}
                    style={({ pressed }: { pressed: boolean }) => [s.endButton, pressed && { opacity: 0.8 }]}
                  >
                    <X size={15} color="#FFFFFF" strokeWidth={2.6} />
                    <Label style={s.endButtonText}>End</Label>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}
        {/* Sits over the top of the map, never over the route buttons. */}
        {mapNotice ? (
          <View accessibilityLabel="Map notice" accessibilityLiveRegion="polite" style={[s.mapNotice, { top: routeActive ? routeBannerSpace : 72 }]}>
            <CheckCheck size={16} color="#D6F3B0" />
            <Label style={{ color: '#F0F5EB', fontSize: 12, lineHeight: 17, flexShrink: 1 }}>{mapNotice}</Label>
          </View>
        ) : null}
        {shopping.completedCount !== null && (
          <View accessibilityLabel="Shopping complete" accessibilityLiveRegion="polite" style={s.completionCard}>
            <View style={[s.row, { gap: 10 }]}>
              <CheckCheck size={27} color={C.green} />
              <View style={{ flex: 1 }}>
                <Label style={s.completionTitle}>You’re done!</Label>
                <Label style={s.listHint}>All {shopping.completedCount} {shopping.completedCount === 1 ? 'product' : 'products'} found.</Label>
              </View>
            </View>
            <Button title="Back to map" secondary onPress={() => { lastActiveAtRef.current = Date.now(); resetShopperLocation(); dispatchShopping({ type: 'dismissCompletion' }); }} />
          </View>
        )}
      </View>
    ) : (
    <ScrollView contentContainerStyle={[s.content, mobile && { padding: 20, paddingTop: 27 }]}><View style={[s.pageHeading, mobile && { alignItems: 'flex-start', gap: 22 }]}><View style={{ maxWidth: '100%', flexShrink: 1 }}><View style={[s.row, { gap: 10 }]}><Label style={s.eyebrow}>EXPLORE YOUR ENVIRONMENT</Label></View><Label style={[s.pageTitle, mobile && { fontSize: 28 }]}>{page}</Label><Label style={s.pageSubtitle}>{page === 'Wi-Fi Scanner' ? 'Discover nearby networks. Understand your signal landscape.' : page === 'Fingerprints' ? 'Capture the signal signatures that make every location unique.' : page === 'Scan History' ? 'A little history. A clearer picture of your environment.' : page === 'Location reports' ? 'Shoppers report a product that moved. Confirm the new shelf or reject it.' : page === 'Walk paths' ? 'The walkways shopper routes follow. Close one while it is cleared, or connect a walkway that changed.' : 'Make LIS work the way you do.'}</Label></View>{page === 'Wi-Fi Scanner' && <Button title={scanning ? 'Scanning…' : 'Scan networks'} onPress={runScan} icon={scanning ? Radio : Wifi} disabled={scanning} />}{page === 'Fingerprints' && <Button title="Save fingerprint" icon={Fingerprint} disabled={!networks.length} onPress={() => setDialog('save')} />}</View>
    {error ? <View style={s.errorBanner}><CircleHelp size={18} color="#A46543" /><Label style={{ flex: 1, color: '#905332', fontSize: 12, lineHeight: 20 }}>{error}</Label><IconButton icon={X} label="Dismiss error" onPress={() => setError('')} /></View> : null}
    {page === 'Wi-Fi Scanner' && <>
    <View style={[s.environmentBar, mobile && { flexWrap: 'wrap', gap: 12 }]}><View style={[s.row, { gap: 7 }]}><MapPin size={14} color="#798571" strokeWidth={1.7} /><Label style={{ fontSize: 11, fontWeight: '500', color: '#677260' }}>Hypermarket</Label><View style={s.tinyDivider} /><Pressable accessibilityRole="button" onPress={() => setDialog('workspace')} style={[s.row, { gap: 7 }]}><Label style={{ fontSize: 11, color: '#8B9285' }}>{zone}</Label><ChevronDown size={11} color="#8B9285" /></Pressable></View><View style={[s.row, { gap: 15 }]}><View style={[s.row, { gap: 6 }]}><View style={[s.dot, { backgroundColor: demo ? '#9DA687' : '#65A06C', width: 5, height: 5 }]} /><Label style={{ fontSize: 10, color: '#818976' }}>{demo ? 'Demo environment' : 'Android device'}</Label></View><View style={s.tinyDivider} /><Label style={{ fontSize: 10, color: '#969B8E' }}>{scanning ? 'Scanning nearby networks…' : lastScan ? `Updated ${lastScan.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : demo ? 'Sample scan data' : 'Ready to scan'}</Label></View></View>
    <View style={[s.stats, compact && { flexWrap: 'wrap' }, mobile && { gap: 12 }]}><StatCard title="Networks detected" value={String(networks.length).padStart(2, '0')} detail="Access points in your vicinity" icon={Wifi}><View style={s.statChip}><View style={[s.dot, { width: 4, height: 4, backgroundColor: '#689365' }]} /><Label style={{ fontSize: 9, color: '#5D8458' }}>{demo ? 'Demo' : 'Nearby'}</Label></View></StatCard><StatCard title="Strongest signal" value={strongest ? String(strongest.rssi) : '—'} unit="dBm" detail={strongest?.ssid || 'Run a scan to get started'} icon={Zap}><View style={{ marginLeft: 'auto' }}>{strongest && <SignalBars rssi={strongest.rssi} size={25} />}</View></StatCard><StatCard title="Average signal" value={average !== null ? String(average) : '—'} unit="dBm" detail={average ? 'Across all detected networks' : 'No measurements yet'} icon={Activity} /><StatCard title="Frequency bands" value={String(new Set(networks.map(n => getBand(n.frequency))).size).padStart(2, '0')} detail={networks.length ? [...new Set(networks.map(n => getBand(n.frequency)))].sort().join(' and ') : 'Scan to discover bands'} icon={Radio}><View style={[s.row, { gap: 4, marginLeft: 'auto', alignItems: 'flex-end' }]}>{[8, 15, 23, 16, 29, 20, 13].map((h, i) => <View key={i} style={{ height: h, width: 4, borderRadius: 2, backgroundColor: i < 3 ? '#C0D5A9' : '#E1E9D9' }} />)}</View></StatCard></View>
    <View style={[s.dashboardColumns, compact && { flexDirection: 'column' }]}><View style={s.networkCard}><View style={[s.cardHeading, { paddingBottom: 10 }]}><View style={[s.row, { gap: 9 }]}><Label style={s.cardTitle}>Nearby networks</Label><View style={s.countBadge}><Label style={{ fontSize: 10, color: '#7C8872' }}>{networks.length}</Label></View></View><View style={[s.row, { gap: 9 }]}><Pressable accessibilityRole="switch" aria-checked={autoScan} accessibilityState={{ checked: autoScan }} accessibilityLabel="Auto-scan every 35 seconds" onPress={() => setAutoScan(!autoScan)} style={[s.row, { gap: 7 }]}><View style={[s.miniToggle, autoScan && { backgroundColor: C.green }]}><View style={[s.toggleKnob, autoScan && { alignSelf: 'flex-end' }]} /></View><Label style={{ fontSize: 10, color: '#93998F' }}>Auto-scan</Label></Pressable><IconButton icon={MoreHorizontal} label="Network actions" onPress={() => setFilterOpen(!filterOpen)} active={filterOpen} /></View></View>
    <View style={[s.tableToolbar, mobile && { flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}><View style={s.tabs}>{['All networks', '2.4 GHz', '5 GHz', ...(networks.some(n => getBand(n.frequency) === '6 GHz') ? ['6 GHz'] : [])].map(tab => <Pressable accessibilityRole="button" accessibilityState={{ selected: tab === band }} key={tab} onPress={() => setBand(tab)} style={[s.tab, band === tab && s.tabSelected]}><Label style={[s.tabText, band === tab && { color: C.green, fontWeight: '600' }]}>{tab}</Label></Pressable>)}</View><View style={[s.row, { gap: 7 }]}><View style={[s.searchBox, mobile && { flex: 1 }]}><Search size={13} color="#9AA193" /><TextInput accessibilityLabel="Search networks" placeholder="Search networks…" placeholderTextColor="#A0A699" value={search} onChangeText={setSearch} style={s.searchInput} />{search.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}><X size={12} color={C.muted} /></Pressable>}</View><Pressable accessibilityRole="button" accessibilityLabel="Filter networks" onPress={() => setFilterOpen(!filterOpen)} style={[s.filterButton, filterOpen && { backgroundColor: C.pale }]}><SlidersHorizontal size={14} color="#7D8878" /></Pressable></View></View>
    {filterOpen && <View style={s.filterPanel}><Pressable accessibilityRole="checkbox" aria-checked={secureOnly} accessibilityState={{ checked: secureOnly }} onPress={() => setSecureOnly(!secureOnly)} style={[s.row, { gap: 8 }]}><View style={[s.checkbox, secureOnly && { backgroundColor: C.green, borderColor: C.green }]}>{secureOnly && <Check size={11} color="white" />}</View><Label style={{ fontSize: 11 }}>Secured networks only</Label></Pressable><Pressable accessibilityRole="button" onPress={() => { setSecureOnly(false); setSearch(''); setBand('All networks'); }}><Label style={{ fontSize: 11, color: C.green }}>Reset filters</Label></Pressable></View>}
    <View style={s.tableHeader}><Label style={[s.columnLabel, { flex: 1.7 }]}>NETWORK NAME</Label>{!mobile && <Label style={[s.columnLabel, { flex: 0.8 }]}>FREQUENCY</Label>}<Pressable accessibilityRole="button" accessibilityLabel={`Sort signal ${sortStrongest ? 'weakest' : 'strongest'} first`} onPress={() => setSortStrongest(!sortStrongest)} style={[s.row, { flex: 0.85, gap: 5 }]}><Label style={s.columnLabel}>SIGNAL</Label><ArrowDown size={11} color="#9CA395" style={{ transform: [{ rotate: sortStrongest ? '0deg' : '180deg' }] }} /></Pressable>{!mobile && <Label style={[s.columnLabel, { width: 83 }]}>QUALITY</Label>}<View style={{ width: 20 }} /></View>
    {scanning && <View style={s.scanningIndicator}><ActivityIndicator size="small" color={C.green} /><Label style={{ fontSize: 11, color: C.green }}>Listening for nearby access points…</Label></View>}
    {visibleNetworks.length ? visibleNetworks.map(network => <Pressable accessibilityRole="button" accessibilityLabel={`${network.ssid}, ${network.rssi} dBm, view details`} key={network.bssid} onPress={() => setSelected(network)} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [s.networkRow, network.connected && { backgroundColor: '#FAFCF8' }, hovered && { backgroundColor: '#F1F6EE' }]}><View style={[s.row, { flex: 1.7, gap: mobile ? 9 : 12 }]}><View style={[s.networkIcon, network.connected && { backgroundColor: '#EAF2E3' }]}><Wifi size={17} color={network.connected ? '#65845A' : '#939E88'} strokeWidth={1.7} /></View><View style={{ flex: 1 }}><View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}><Label numberOfLines={1} style={s.networkName}>{network.ssid}</Label>{network.connected && <View style={s.connectedBadge}><Label style={{ fontSize: 8, color: '#638051' }}>Connected</Label></View>}</View><View style={[s.row, { gap: 5, marginTop: 6 }]}>{network.security === 'Open' ? <LockKeyholeOpen size={9} color="#A8AE9F" /> : <LockKeyhole size={9} color="#A8AE9F" />}<Label style={s.bssid}>{network.bssid}</Label></View></View></View>{!mobile && <View style={{ flex: 0.8 }}><Label style={{ fontSize: 11, color: '#697261' }}>{getBand(network.frequency)}</Label><Label style={{ fontSize: 9, color: '#A4AA9D', marginTop: 5 }}>Ch. {getChannel(network.frequency)}</Label></View>}<View style={[s.row, { flex: 0.85, gap: 9 }]}><SignalBars rssi={network.rssi} size={17} /><Label style={{ fontSize: 12, fontWeight: '600', color: '#53624B' }}>{network.rssi}<Label style={{ fontSize: 9, color: '#A2A99A', fontWeight: '400' }}> dBm</Label></Label></View>{!mobile && <View style={{ width: 83 }}><Quality rssi={network.rssi} /></View>}<ChevronRight size={14} color="#B6BEAE" style={{ width: 20 }} /></Pressable>) : <View style={s.emptyState}><Wifi size={32} color="#A4B399" /><Label style={s.emptyTitle}>{networks.length ? 'No matching networks' : 'Your next discovery starts here'}</Label><Label style={s.emptyText}>{networks.length ? 'Try another name or clear your filters.' : 'Tap Scan networks to discover nearby Wi-Fi signals.'}</Label>{networks.length > 0 && <Button title="Clear filters" secondary small onPress={() => { setSearch(''); setBand('All networks'); setSecureOnly(false); }} />}</View>}
    <View style={s.tableFooter}><View style={[s.row, { gap: 6 }]}><View style={[s.dot, { backgroundColor: '#8CA777', width: 4, height: 4 }]} /><Label style={{ fontSize: 10, color: '#919B86' }}>Showing {visibleNetworks.length} of {networks.length} networks</Label></View><Pressable accessibilityRole="button" disabled={!networks.length} onPress={() => exportNetworks()} style={[s.row, { gap: 6 }]}><ArrowDownToLine size={12} color="#7D8E72" /><Label style={{ fontSize: 10, color: '#768769', fontWeight: '500' }}>Export CSV</Label></Pressable></View></View>
    <View style={[s.rightColumn, compact && { width: '100%', flexDirection: mobile ? 'column' : 'row' }]}><View style={[s.overviewCard, compact && { flex: 1 }]}><View style={s.between}><Label style={s.cardTitle}>Signal overview</Label><View style={s.livePill}><View style={[s.dot, { width: 4, height: 4, backgroundColor: '#7D9F68' }]} /><Label style={{ fontSize: 8, color: '#7D926C', fontWeight: '600', letterSpacing: 0.5 }}>{demo ? 'DEMO' : scanning ? 'SCANNING' : 'LOCAL'}</Label></View></View><Label style={s.cardSubtitle}>A little perspective on your surroundings.</Label><Radar networks={networks} scanning={scanning} /><View style={s.radarCaption}><View style={[s.dot, { backgroundColor: C.green, width: 5, height: 5 }]} /><Label style={{ fontSize: 9, color: '#929D86' }}>{demo ? 'Illustrative signal distribution' : 'Signal distribution · not actual positions'}</Label></View><View style={s.distributionBar}>{[excellentCount, fairCount, weakCount].map((count, i) => count > 0 ? <View key={i} style={{ flex: count, backgroundColor: ['#749363', '#B4C78F', '#E1D7B5'][i], height: 5 }} /> : null)}</View><View style={[s.row, { justifyContent: 'space-between', marginTop: 11 }]}>{[['Strong', excellentCount, '#749363'], ['Fair', fairCount, '#B4C78F'], ['Weak', weakCount, '#DACEAD']].map(([name, count, color]) => <View key={name} style={[s.row, { gap: 5 }]}><View style={[s.dot, { width: 5, height: 5, backgroundColor: String(color) }]} /><Label style={{ fontSize: 9, color: '#8C9880' }}>{name} <Label style={{ fontSize: 9, fontWeight: '600', color: '#69755E' }}>{count}</Label></Label></View>)}</View></View>
    <View style={[s.connectedCard, compact && { flex: 1 }]}><View style={[s.row, { gap: 8 }]}><View style={s.connectionIcon}><ShieldCheck size={17} color="#5F7B4E" strokeWidth={1.6} /></View><Label style={{ fontSize: 12, fontWeight: '600', color: '#5D7150' }}>{connected ? 'You’re well connected' : 'Your connection'}</Label></View><Label style={{ fontSize: 12, fontWeight: '600', marginTop: 17, color: '#526648' }}>{connected?.ssid || 'Connection status unavailable'}</Label><Label style={{ fontSize: 10, color: '#90A080', marginTop: 6 }}>{connected ? `${getBand(connected.frequency)}  ·  ${connected.security === 'Open' ? 'Open network' : `${connected.security} secured`}` : 'Scans list access points without identifying your connection.'}</Label><View style={[s.between, { marginTop: 20, borderTopWidth: 1, borderTopColor: '#E1E9D8', paddingTop: 14 }]}><Label style={{ fontSize: 10, color: '#8A9B79' }}>Connection strength</Label><View style={[s.row, { gap: 6 }]}>{connected && <SignalBars rssi={connected.rssi} size={13} />}<Label style={{ fontSize: 10, fontWeight: '600', color: '#657E51' }}>{connected ? signalQuality(connected.rssi) : '—'}</Label></View></View></View></View></View>
    <View style={[s.infoStrip, mobile && { alignItems: 'flex-start' }]}><View style={s.infoIcon}><Radio size={18} color="#8A9B78" strokeWidth={1.5} /></View><View style={{ flex: 1 }}><Label style={{ fontSize: 11, fontWeight: '600', color: '#718361' }}>Good positioning starts with good signals.</Label><Label style={{ fontSize: 10, color: '#99A18E', marginTop: 5, lineHeight: 17 }}>{demo ? 'You’re exploring demo data. Use an Android development build to scan real Wi-Fi networks.' : 'Keep Wi-Fi and location services on. Android may return cached results; network positions and connection status are not measured.'}</Label></View><Pressable accessibilityRole="button" onPress={() => setDialog('help')} style={[s.row, { gap: 6 }]}><Label style={{ fontSize: 10, color: '#7C8B6C', fontWeight: '500' }}>{mobile ? 'Learn' : 'How it works'}</Label><ArrowUpRight size={13} color="#839575" /></Pressable></View>
    </>}

    {page === 'Fingerprints' && <View style={s.largeCard}><View style={s.between}><Label style={s.cardTitle}>Your signal library</Label><Label style={s.cardSubtitle}>{snapshots.length} saved this session</Label></View>{snapshots.length ? snapshots.map(snapshot => <View key={snapshot.id} style={[s.historyRow, mobile && { flexWrap: 'wrap' }]}><View style={s.networkIcon}><Fingerprint color={C.green} size={21} /></View><View style={{ flex: 1 }}><Label style={{ fontWeight: '600' }}>{snapshot.name}</Label><Label style={s.cardSubtitle}>{snapshot.zone} · {snapshot.networks.length} access points · {snapshot.time.toLocaleTimeString()}</Label></View><Button title="View signals" small secondary onPress={() => { setNetworks(snapshot.networks); setDemo(snapshot.demo); setLastScan(snapshot.time); setZone(snapshot.zone); navigate('Wi-Fi Scanner'); setNotice(`Viewing fingerprint: ${snapshot.name}`); }} /></View>) : <View style={s.emptyState}><View style={s.emptyIcon}><Fingerprint size={35} color={C.green} strokeWidth={1.4} /></View><Label style={s.emptyTitle}>Give every place a signature.</Label><Label style={s.emptyText}>Save the current scan with a location name.{ '\n' }Your fingerprints stay available for this session.</Label><Button title="Save your first fingerprint" icon={Fingerprint} disabled={!networks.length} onPress={() => setDialog('save')} /></View>}</View>}
    {page === 'Scan History' && <View style={s.largeCard}><View style={s.between}><Label style={s.cardTitle}>Recent scans</Label><View style={s.row}><Label style={s.cardSubtitle}>This session</Label>{history.length > 0 && <IconButton icon={X} label="Clear scan history" onPress={() => { setHistory([]); setNotice('Scan history cleared.'); }} />}</View></View>{history.length ? history.map(record => <View key={record.id} style={s.historyRow}><View style={s.networkIcon}><Wifi size={20} color={C.green} /></View><View style={{ flex: 1 }}><Label style={{ fontWeight: '600', fontSize: 13 }}>{record.networks.length} networks discovered</Label><Label style={s.cardSubtitle}>{record.time.toLocaleTimeString()} · {record.demo ? 'Demo scan' : 'Device scan'}</Label></View><Button title="View scan" small secondary onPress={() => { setNetworks(record.networks); setDemo(record.demo); setLastScan(record.time); navigate('Wi-Fi Scanner'); }} /></View>) : <View style={s.emptyState}><View style={s.emptyIcon}><Clock3 size={35} color={C.green} strokeWidth={1.4} /></View><Label style={s.emptyTitle}>A fresh start.</Label><Label style={s.emptyText}>Your completed scans will appear here.{ '\n' }Run your first scan to see what’s around you.</Label><Button title="Go to scanner" onPress={() => navigate('Wi-Fi Scanner')} icon={ArrowRight} /></View>}</View>}
    {page === 'Location reports' && <View style={s.largeCard} accessibilityLabel="Location reports list">
      <View style={s.between}><View style={{ flex: 1 }}><Label style={s.cardTitle}>Location reports</Label><Label style={s.cardSubtitle}>Only moved-shelf reports. Out of stock is not collected, because that would need a specific brand.</Label></View><Button small secondary title="Refresh" onPress={() => setReportsReload((value) => value + 1)} /></View>
      {reportsError ? <View style={s.errorBanner}><CircleHelp size={18} color="#A46543" /><Label style={{ flex: 1, color: '#905332', fontSize: 12 }}>{reportsError}</Label></View> : null}
      {reportsLoading ? <View style={s.emptyState}><ActivityIndicator color={C.green} /><Label style={s.emptyText}>Loading reports…</Label></View> : locationReports.length ? locationReports.map((report) => (
        <View key={report.id} accessibilityLabel={`Location report ${report.id} for ${report.productName}`} style={[s.historyRow, mobile && { flexWrap: 'wrap' }]}>
          <View style={s.networkIcon}><Flag size={18} color={report.status === 'pending' ? '#A56A32' : C.green} /></View>
          <View style={{ flex: 1, minWidth: 180 }}>
            <Label style={{ fontWeight: '600' }}>{report.productName}</Label>
            <Label style={s.cardSubtitle}>Was: {report.originalAisleLocation}</Label>
            <Label style={s.cardSubtitle}>Reported: {report.reportedAisleLocation}</Label>
            <Label style={s.reportStatus}>{report.status}</Label>
          </View>
          {report.status === 'pending' && (
            <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
              <Button title="Confirm move" label={`Confirm report ${report.id}`} disabled={reportBusyId === report.id} onPress={() => reviewLocationReport(report.id, 'confirm')} />
              <Button title="Reject" label={`Reject report ${report.id}`} secondary disabled={reportBusyId === report.id} onPress={() => reviewLocationReport(report.id, 'reject')} />
            </View>
          )}
        </View>
      )) : <View style={s.emptyState}><View style={s.emptyIcon}><Flag size={32} color={C.green} /></View><Label style={s.emptyTitle}>No location reports yet.</Label><Label style={s.emptyText}>When a shopper taps Not here and marks the shelf they actually saw, it shows up here.</Label></View>}
    </View>}
    {page === 'Walk paths' && <View style={[s.largeCard, mobile && { padding: 18 }]} accessibilityLabel="Walk paths list">
      <View style={[s.between, { gap: 12, flexWrap: 'wrap' }]}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Label style={s.cardTitle}>Walkable paths</Label>
          <Label style={s.cardSubtitle}>{walkEdges.length} connections · {blockedWalkCount} blocked. Tap a walkway on the map to block or reopen it while an aisle is cleared.</Label>
        </View>
        <Button small secondary title="Refresh" onPress={() => setWalkReload((value) => value + 1)} />
      </View>
      {walkError ? <View style={[s.errorBanner, { marginTop: 14, marginBottom: 4 }]}><CircleHelp size={18} color="#A46543" /><Label style={{ flex: 1, color: '#905332', fontSize: 12 }}>{walkError}</Label></View> : null}
      {walkLoading && !walkGraph ? (
        <View style={s.emptyState}><ActivityIndicator color={C.green} /><Label style={s.emptyText}>Loading walk paths…</Label></View>
      ) : !walkGraph ? (
        <View style={s.emptyState}><View style={s.emptyIcon}><Route size={32} color={C.green} strokeWidth={1.5} /></View><Label style={s.emptyTitle}>No walk paths yet.</Label><Label style={s.emptyText}>Once the store paths load, every connection can be blocked or reopened from here.</Label></View>
      ) : (
        <>
          <View style={[s.walkMapPanel, mobile && { padding: 10 }]}>
            <View style={s.walkMapHeader}>
              <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
                <View style={s.walkLegendPill}>
                  <View style={s.walkLegendLineOpen} />
                  <Label style={s.walkLegendOpenText}>Open ({walkEdges.length - blockedWalkCount})</Label>
                </View>
                <View style={[s.walkLegendPill, s.walkLegendPillBlocked]}>
                  <View style={s.walkLegendBadgeBlocked}><Label style={s.walkLegendBadgeCross}>×</Label></View>
                  <Label style={s.walkLegendBlockedText}>Closed ({blockedWalkCount})</Label>
                </View>
              </View>
              <Label accessibilityLiveRegion="polite" style={s.walkMapHint}>
                {walkBusy ? 'Saving walkway…' : walkLastAction || 'Tap any walkway segment to toggle'}
              </Label>
            </View>
            <WalkPathsMap
              walkGraph={walkGraph}
              networks={networks}
              portrait={portrait}
              disabled={walkBusy}
              onToggleEdge={(edge) => { void toggleWalkEdge(edge); }}
            />
          </View>
          <View style={s.walkAddSection}>
            <Label style={s.cardTitle}>Add a connection</Label>
            <Label style={s.cardSubtitle}>Pick two junctions that should be linked, like a new cut-through between aisles.</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
              {sortedWalkNodes.map((node) => {
                const selected = walkFrom === node.id;
                return (
                  <Pressable accessibilityRole="button" accessibilityLabel={`From junction: ${node.label}`} accessibilityState={{ selected }} key={`from-${node.id}`} onPress={() => setWalkFrom(selected ? null : node.id)} style={[s.walkChip, selected && s.walkChipActive]}>
                    <Label style={selected ? { color: '#FFF', fontSize: 11, fontWeight: '600' } : { fontSize: 11 }}>{node.label}</Label>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 12 }}>
              {sortedWalkNodes.map((node) => {
                const selected = walkTo === node.id;
                return (
                  <Pressable accessibilityRole="button" accessibilityLabel={`To junction: ${node.label}`} accessibilityState={{ selected }} key={`to-${node.id}`} onPress={() => setWalkTo(selected ? null : node.id)} style={[s.walkChip, selected && s.walkChipActive]}>
                    <Label style={selected ? { color: '#FFF', fontSize: 11, fontWeight: '600' } : { fontSize: 11 }}>{node.label}</Label>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={s.row}>
              <Button
                title="Add connection"
                icon={Plus}
                disabled={walkBusy || walkFrom === null || walkTo === null || walkFrom === walkTo || walkEdges.some((edge) => (edge.fromNodeId === walkFrom && edge.toNodeId === walkTo) || (edge.fromNodeId === walkTo && edge.toNodeId === walkFrom))}
                onPress={() => { void addWalkConnection(); }}
              />
            </View>
          </View>
          <View style={[s.between, s.walkListHeader]}>
            <Label style={s.cardTitle}>Connections</Label>
            <View style={s.tabs}>
              {([
                ['all', `All (${walkEdges.length})`],
                ['blocked', `Blocked (${blockedWalkCount})`],
              ] as const).map(([key, text]) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={key === 'all' ? 'Show all connections' : 'Show blocked connections'}
                  accessibilityState={{ selected: walkFilter === key }}
                  onPress={() => setWalkFilter(key)}
                  style={[s.tab, walkFilter === key && s.tabSelected]}
                >
                  <Label style={[s.tabText, walkFilter === key && { color: C.green, fontWeight: '600' }]}>{text}</Label>
                </Pressable>
              ))}
            </View>
          </View>
          {visibleWalkEdges.length ? visibleWalkEdges.map((edge) => (
            <View key={edge.id} accessibilityLabel={`Walk connection ${edge.id}: ${edge.name}`} style={[s.historyRow, mobile && { flexWrap: 'wrap' }]}>
              <View style={[s.networkIcon, edge.blocked && { backgroundColor: '#FDF0ED' }]}><Route size={18} color={edge.blocked ? '#B43E2B' : C.green} /></View>
              <View style={{ flex: 1, minWidth: 170 }}>
                <Label style={{ fontWeight: '600' }}>{edge.name}</Label>
                <Label style={s.cardSubtitle}>{edge.blocked ? 'Blocked · shoppers walk around it' : 'Open'}</Label>
              </View>
              <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
                <Button small secondary title={edge.blocked ? 'Reopen' : 'Block'} label={`${edge.blocked ? 'Reopen' : 'Block'} connection ${edge.id}`} disabled={walkBusy} onPress={() => { void toggleWalkEdge(edge); }} />
                <Button small secondary title="Remove" label={`Remove connection ${edge.id}`} disabled={walkBusy} onPress={() => setWalkDeleteEdge(edge)} />
              </View>
            </View>
          )) : (
            <View style={{ paddingVertical: 22 }}><Label style={s.cardSubtitle}>All walkways are open right now.</Label></View>
          )}
        </>
      )}
    </View>}
    {page === 'Settings' && <View style={s.largeCard}><Label style={s.cardTitle}>Scanner preferences</Label><View style={s.settingRow}><View style={{ flex: 1 }}><Label style={s.settingTitle}>Demo environment</Label><Label style={s.settingDescription}>{supportsNativeScan ? 'Explore sample networks instead of your device’s Wi-Fi signals.' : 'Required on web and iOS. Real scanning is available in an Android native build.'}</Label></View><Switch accessibilityLabel="Demo environment" value={demo} disabled={!supportsNativeScan || scanning} onValueChange={changeDemo} trackColor={{ false: '#DDE4D7', true: C.green }} /></View><View style={s.settingRow}><View style={{ flex: 1 }}><Label style={s.settingTitle}>Automatic scanning</Label><Label style={s.settingDescription}>Refresh networks every 35 seconds while the scanner is open.</Label></View><Switch accessibilityLabel="Automatic scanning" value={autoScan} onValueChange={setAutoScan} trackColor={{ false: '#DDE4D7', true: C.green }} /></View><View style={s.settingRow}><View style={{ flex: 1 }}><Label style={s.settingTitle}>Privacy by design</Label><Label style={s.settingDescription}>Scans stay on your device. Session history and fingerprints clear when the app restarts. Export a CSV to keep your measurements.</Label></View><ShieldCheck size={23} color={C.green} /></View><View style={s.settingRow}><View style={{ flex: 1 }}><Label style={s.settingTitle}>Native setup</Label><Label style={s.settingDescription}>Run npm run android with a connected Android device. Grant location permission and enable Wi-Fi and location services. Expo Go cannot load the native Wi-Fi module.</Label></View><BookOpen size={23} color={C.green} /></View></View>}
    <View style={s.pageFooter}><Label style={{ fontSize: 9, color: '#AFB5A6' }}>LIS — Location Intelligence System</Label><View style={[s.row, { gap: 5 }]}><LockKeyhole size={10} color="#9DA891" /><Label style={{ fontSize: 9, color: '#A2AC97' }}>Your signals stay yours.</Label></View></View>
    </ScrollView>
    )}
    </View>
    {notice && page !== 'Indoor Map' ? <View style={[s.toast, mobile && { left: 20, right: 20, bottom: 22 }]}><CheckCheck size={17} color="#D6F3B0" /><Label style={{ color: '#F0F5EB', fontSize: 12, flexShrink: 1 }}>{notice}</Label></View> : null}
    <Modal visible={walkDeleteEdge !== null} transparent animationType="fade" onRequestClose={() => setWalkDeleteEdge(null)}>
      <View style={[s.modalBackdrop, { paddingTop: 16 + safeTop, paddingBottom: 16 + safeBottom }]}>
        <View accessibilityLabel="Confirm walk path removal" style={[s.modalCard, mobile && { width: '94%', padding: 23 }]}>
          <View style={[s.between, { marginBottom: 18 }]}>
            <View style={s.modalIcon}><RouteOff size={23} color="#9A5A2E" /></View>
            <IconButton icon={X} label="Cancel remove connection" onPress={() => setWalkDeleteEdge(null)} />
          </View>
          <Label style={s.modalTitle}>Remove this connection?</Label>
          <Label style={[s.modalDescription, { marginTop: 10 }]}>{walkDeleteEdge?.name}</Label>
          <Label style={[s.modalDescription, { marginTop: 14 }]}>Shoppers will use other open paths. You can add the connection again later.</Label>
          <View style={[s.row, { gap: 10, marginTop: 24, flexWrap: 'wrap' }]}>
            <Button secondary title="Keep connection" onPress={() => setWalkDeleteEdge(null)} />
            <Button title="Remove connection" label={walkDeleteEdge ? `Confirm remove connection ${walkDeleteEdge.id}` : 'Confirm remove connection'} disabled={walkBusy} onPress={() => {
              const edge = walkDeleteEdge;
              if (!edge) return;
              void changeWalkPaths(token => callWalkApi(token, `/walk/edges/${edge.id}`, { method: 'DELETE' })).then(done => { if (done) setWalkDeleteEdge(null); });
            }} />
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={menuOpen && staffMode} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}><View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#14261966' }}>{sidebar}<Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={() => setMenuOpen(false)} style={{ flex: 1, padding: 20, paddingTop: 20 + safeTop }}><X size={23} color="white" /></Pressable></View></Modal>
    <Modal visible={!!dialog || !!selected} transparent animationType="fade" onRequestClose={() => { setDialog(null); setSelected(null); }}><Pressable onPress={() => { setDialog(null); setSelected(null); }} style={[s.modalBackdrop, { paddingTop: 16 + safeTop, paddingBottom: 16 + safeBottom }]}><Pressable onPress={e => e.stopPropagation()} style={[s.modalCard, mobile && { width: '94%', padding: 23 }]}><View style={[s.between, { marginBottom: 18 }]}><View style={s.modalIcon}>{selected ? <Wifi size={23} color={C.green} /> : dialog === 'save' ? <Fingerprint size={23} color={C.green} /> : dialog === 'notifications' ? <Bell size={23} color={C.green} /> : dialog === 'workspace' ? <LayoutGrid size={23} color={C.green} /> : <MapPin size={23} color={C.green} />}</View><IconButton icon={X} label="Close dialog" onPress={() => { setDialog(null); setSelected(null); }} /></View>
    {selected && <><Label style={s.modalTitle}>{selected.ssid}</Label><Label style={s.modalDescription}>{demo ? 'Demo access point' : 'Nearby access point'} · {selected.bssid}</Label><View style={[s.row, { gap: 15, marginVertical: 22 }]}><SignalBars rssi={selected.rssi} size={32} /><Label style={{ fontSize: 35, fontWeight: '600', color: C.green }}>{selected.rssi}<Label style={{ fontSize: 16, color: C.muted }}> dBm</Label></Label><Quality rssi={selected.rssi} /></View>{[['Frequency', `${selected.frequency} MHz · ${getBand(selected.frequency)}`], ['Channel', String(getChannel(selected.frequency))], ['Security', selected.security], ['Status', selected.connected ? 'Connected to this network' : demo ? 'Available in your vicinity' : 'Connection status unavailable']].map(([label, value]) => <View style={s.detailRow} key={label}><Label style={{ fontSize: 12, color: C.muted }}>{label}</Label><Label style={{ fontSize: 12, fontWeight: '500' }}>{value}</Label></View>)}<Label style={[s.modalDescription, { marginTop: 22 }]}>Closer to zero means a stronger signal. LIS observes nearby networks without connecting to them.</Label></>}
    {dialog === 'help' && <><Label style={s.modalTitle}>A smarter sense of place.</Label><Label style={s.modalDescription}>LIS turns nearby Wi-Fi signals into the building blocks of indoor positioning.</Label>{[['01', 'Discover your surroundings', 'Scan nearby access points and compare their received signal strength (RSSI), measured in dBm.'], ['02', 'Get to know your signals', 'Strong signals are closer to zero. Below −75 dBm, a signal may be less reliable for positioning.'], ['03', 'Build a location fingerprint', 'Save scans at known locations to create unique signal signatures for your hypermarket.']].map(([num, title, text]) => <View key={num} style={{ flexDirection: 'row', gap: 14, marginTop: 23 }}><Label style={{ color: '#83A167', fontSize: 13, fontWeight: '600' }}>{num}</Label><View style={{ flex: 1 }}><Label style={{ fontSize: 13, fontWeight: '600' }}>{title}</Label><Label style={[s.modalDescription, { marginTop: 6 }]}>{text}</Label></View></View>)}<View style={[s.infoStrip, { padding: 14, marginTop: 23 }]}><Label style={{ fontSize: 11, lineHeight: 18, color: '#7D8D6C' }}>Real scans require an Android native build, Wi-Fi, and location permission. Browsers and iOS cannot list nearby Wi-Fi networks; this preview uses labeled sample data.</Label></View></>}
    {dialog === 'notifications' && <><Label style={s.modalTitle}>You’re all caught up.</Label><Label style={s.modalDescription}>Your workspace is ready to explore. Completed scans appear in Scan History.</Label><View style={[s.infoStrip, { marginVertical: 20 }]}><ShieldCheck size={21} color={C.green} /><Label style={{ flex: 1, fontSize: 12, color: '#798B69', lineHeight: 19 }}>No cloud connection is needed. Your scan data stays in your current session.</Label></View><Button title="Back to exploring" onPress={() => setDialog(null)} icon={ArrowRight} /></>}
    {dialog === 'save' && <><Label style={s.modalTitle}>Save a fingerprint</Label><Label style={s.modalDescription}>Give this set of {networks.length} signals a place in your hypermarket.</Label><Label style={s.inputLabel}>LOCATION NAME</Label><TextInput accessibilityLabel="Fingerprint location name" value={snapshotName} onChangeText={setSnapshotName} autoFocus placeholder="e.g. Aisle 3 · Fresh produce" placeholderTextColor="#A0AA96" style={s.modalInput} maxLength={80} onSubmitEditing={saveSnapshot} /><Label style={{ fontSize: 11, color: C.muted, marginBottom: 22 }}>{zone} · Saved for this session</Label><Button title="Save fingerprint" icon={Fingerprint} disabled={!snapshotName.trim()} onPress={saveSnapshot} /></>}
    {dialog === 'workspace' && <><Label style={s.modalTitle}>Your hypermarket workspace</Label><Label style={s.modalDescription}>Select the area you’re exploring. Location labels help organize your signal fingerprints.</Label><View style={{ gap: 10, marginTop: 23, marginBottom: 12 }}>{['Ground floor', 'First floor', 'Warehouse'].map(item => <Pressable accessibilityRole="button" key={item} onPress={() => { setZone(item); setDialog(null); }} style={[s.zoneOption, zone === item && { borderColor: '#B5C8A7', backgroundColor: '#F3F7EF' }]}><MapPin size={17} color={zone === item ? C.green : C.muted} /><Label style={{ flex: 1, fontSize: 13 }}>{item}</Label>{zone === item && <Check size={17} color={C.green} />}</Pressable>)}</View><Label style={s.modalDescription}>LIS Workspace · Local session</Label></>}
    </Pressable></Pressable></Modal>
  </View>;
}

const s = StyleSheet.create({
  app: { flex: 1, flexDirection: 'row', backgroundColor: C.bg },
  text: { fontFamily: Platform.OS === 'web' ? 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' : undefined, color: C.text, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center' }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sidebar: { width: 225, flexGrow: 0, flexShrink: 0, backgroundColor: '#FFFFFF', borderRightWidth: 1, borderRightColor: C.line },
  sidebarContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 32, paddingBottom: 20 },
  mobileSidebar: { width: 260 }, brand: { paddingHorizontal: 13, marginBottom: 29 }, logoIcon: { width: 37, height: 37, backgroundColor: C.green, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, brandName: { fontSize: 38, fontWeight: '700', letterSpacing: -2.8, marginLeft: 10, lineHeight: 43 }, brandTagline: { fontSize: 8, letterSpacing: 1.5, color: '#9AAB91', marginTop: 9, fontWeight: '500' },
  workspace: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 10, borderWidth: 1, borderColor: '#E8ECE4', borderRadius: 8, gap: 10, marginBottom: 31 }, workspaceIcon: { width: 31, height: 31, borderRadius: 6, backgroundColor: '#F0F4ED', alignItems: 'center', justifyContent: 'center' }, navSection: { fontSize: 8, letterSpacing: 1.35, color: '#A6ADA0', fontWeight: '500', marginBottom: 15, paddingLeft: 13 }, navItem: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, height: 43, borderRadius: 7 }, navText: { fontSize: 12, color: '#7D8677', flex: 1 }, navActive: { backgroundColor: '#EAF1E4' }, activeDot: { height: 5, width: 5, borderRadius: 3, backgroundColor: '#6D895A', marginRight: 2 },
  sidebarPromo: { backgroundColor: '#254F3C', borderRadius: 10, padding: 19, paddingTop: 22, overflow: 'hidden', marginHorizontal: 3, marginBottom: 25 }, promoIcon: { width: 37, height: 37, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 22, borderWidth: 1, borderColor: '#5D7650' }, promoOrbit: { position: 'absolute', left: -10, top: -10, width: 57, height: 57, borderWidth: 1, borderRadius: 40, borderColor: '#466546' }, promoTitle: { color: '#F0F5E5', fontSize: 16, fontWeight: '500', lineHeight: 23, letterSpacing: -0.2 }, promoText: { color: '#A7BC9A', fontSize: 10, lineHeight: 17, marginTop: 9 }, promoLink: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 19 }, sidebarBottom: { borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 16, gap: 1 }, sidebarFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 22, paddingHorizontal: 6 }, staffBar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, marginTop: 12, paddingHorizontal: 4 },
  main: { flex: 1, minWidth: 0 }, topbar: { height: 68, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, breadcrumb: { color: '#959D90', fontSize: 11 }, breadcrumbCurrent: { color: '#56644D', fontSize: 11, fontWeight: '500' }, headerDivider: { height: 19, width: 1, backgroundColor: '#EBEEE7' }, avatar: { width: 31, height: 31, backgroundColor: '#E9EFDF', borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#F3F6EE' }, iconButton: { padding: 7, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 32, paddingTop: 27, maxWidth: 1600, width: '100%', alignSelf: 'center' }, pageHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }, eyebrow: { color: '#99A18F', fontSize: 8, fontWeight: '500', letterSpacing: 1.6 }, pageTitle: { fontSize: 30, fontWeight: '600', letterSpacing: -1, marginTop: 8, color: '#26352B' }, pageSubtitle: { fontSize: 13, color: '#8A9483', marginTop: 7, lineHeight: 19 }, button: { backgroundColor: C.green, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, buttonText: { fontSize: 12, fontWeight: '500', color: '#FFF' }, secondaryButton: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DEE5D6' },
  environmentBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.line, marginBottom: 18 }, tinyDivider: { height: 11, width: 1, backgroundColor: '#DDE3D5', marginHorizontal: 3 }, dot: { width: 6, height: 6, borderRadius: 5 },
  stats: { flexDirection: 'row', gap: 16, marginBottom: 20 }, statCard: { flex: 1, minWidth: 140, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EAE1', borderRadius: 9, padding: 18, paddingTop: 15, paddingBottom: 15 }, statLabel: { fontSize: 11, fontWeight: '500', color: '#839077' }, statValue: { fontSize: 30, fontWeight: '500', letterSpacing: -1.2, lineHeight: 36, color: '#34462C' }, statUnit: { fontSize: 12, color: '#9AA48E' }, statDetail: { fontSize: 10, color: '#97A08C', marginTop: 5 }, statChip: { backgroundColor: '#EFF6E9', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, marginLeft: 6, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center' },
  dashboardColumns: { flexDirection: 'row', gap: 22, alignItems: 'stretch' }, networkCard: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#E4EAE0', backgroundColor: '#FFF', overflow: 'hidden', minWidth: 0 }, cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 21, paddingTop: 13, paddingBottom: 10 }, cardTitle: { fontSize: 14, fontWeight: '600', color: '#405237', letterSpacing: -0.1 }, countBadge: { paddingHorizontal: 7, paddingVertical: 2, backgroundColor: '#EFF3E9', borderRadius: 5 }, miniToggle: { width: 23, height: 13, backgroundColor: '#E3E8DD', borderRadius: 8, padding: 2, justifyContent: 'center' }, toggleKnob: { height: 9, width: 9, borderRadius: 5, backgroundColor: '#FFF' },
  tableToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, gap: 8 }, tabs: { flexDirection: 'row', backgroundColor: '#F5F7F1', borderRadius: 5, padding: 3, gap: 2 }, tab: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 4 }, tabSelected: { backgroundColor: '#FFF', boxShadow: '0 1px 4px #283b2810' }, tabText: { fontSize: 10, color: '#87947B' }, searchBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E7EBE1', borderRadius: 5, paddingHorizontal: 9, height: 30, gap: 6, width: 152 }, searchInput: { flex: 1, fontSize: 10, color: '#59694E', outlineWidth: 0, minWidth: 0, height: 28 }, filterButton: { height: 30, width: 30, borderWidth: 1, borderColor: '#E7EBE1', borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 21, height: 32, backgroundColor: '#FAFBF8', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#EDF0E9' }, columnLabel: { fontSize: 8, letterSpacing: 0.7, color: '#8C9880', fontWeight: '500' }, networkRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 21, height: 55, borderBottomWidth: 1, borderBottomColor: '#EFF2EB' }, networkIcon: { width: 31, height: 31, borderRadius: 7, backgroundColor: '#F3F6EF', alignItems: 'center', justifyContent: 'center' }, networkName: { fontSize: 11.5, fontWeight: '500', color: '#4C5D42', flexShrink: 1 }, connectedBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, backgroundColor: '#EDF4E4' }, bssid: { color: '#98A38E', fontSize: 8.5, letterSpacing: 0.2, fontFamily: Platform.OS === 'web' ? '"SFMono-Regular", Consolas, monospace' : 'monospace' }, quality: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 4, alignSelf: 'flex-start' }, tableFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 21, paddingVertical: 14, marginTop: 'auto' },
  rightColumn: { width: 283, gap: 20 }, overviewCard: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E4EAE0', borderRadius: 10, padding: 20, paddingTop: 21, paddingBottom: 19 }, cardSubtitle: { fontSize: 9, color: '#A0A995', marginTop: 7, lineHeight: 16 }, livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 4, backgroundColor: '#F0F5E9' }, radarCaption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: -2 }, distributionBar: { height: 5, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', gap: 3, marginTop: 23, backgroundColor: '#F3F6EE' }, connectedCard: { backgroundColor: '#F0F5E8', borderWidth: 1, borderColor: '#E2EAD7', borderRadius: 10, padding: 20 }, connectionIcon: { backgroundColor: '#E3ECD6', width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  infoStrip: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 18, marginTop: 22, backgroundColor: '#F0F4EA', borderWidth: 1, borderColor: '#E7EDDF', borderRadius: 8 }, infoIcon: { width: 34, height: 34, borderRadius: 7, backgroundColor: '#E9EFDF', alignItems: 'center', justifyContent: 'center' }, pageFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 27, marginBottom: 3 },
  filterPanel: { padding: 14, marginHorizontal: 20, marginBottom: 14, backgroundColor: '#F3F7EF', borderRadius: 5, flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, checkbox: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: '#B9C4B1', alignItems: 'center', justifyContent: 'center' }, scanningIndicator: { padding: 13, backgroundColor: '#F1F7EA', flexDirection: 'row', alignItems: 'center', gap: 10 }, errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF3E9', borderWidth: 1, borderColor: '#EACFB9', borderRadius: 8, padding: 12, marginBottom: 20 },
  largeCard: { padding: 25, borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: '#FFF' }, emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20, gap: 15 }, emptyIcon: { width: 78, height: 78, borderRadius: 22, backgroundColor: C.pale, alignItems: 'center', justifyContent: 'center', marginBottom: 5 }, emptyTitle: { fontSize: 19, fontWeight: '500', color: '#4B6240', textAlign: 'center' }, emptyText: { fontSize: 12, lineHeight: 21, color: '#97A18E', textAlign: 'center', marginVertical: 4 }, historyRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: C.line }, settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: C.line, gap: 25 }, settingTitle: { fontSize: 13, fontWeight: '500', color: '#4E6243' }, settingDescription: { fontSize: 12, lineHeight: 21, color: '#919E86', marginTop: 7, maxWidth: 630 },
  toast: { position: 'absolute', bottom: 30, right: 35, backgroundColor: C.dark, borderRadius: 9, paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 10, boxShadow: '0 8px 30px #142a1922', maxWidth: 450 },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1C2E2860', padding: 16 }, modalCard: { width: 480, maxHeight: '95%', backgroundColor: '#FFF', borderRadius: 16, padding: 30, boxShadow: '0 20px 80px #12271b33' }, modalIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#EEF4E7', justifyContent: 'center', alignItems: 'center' }, modalTitle: { fontSize: 23, fontWeight: '600', letterSpacing: -0.5, color: '#334A2B' }, modalDescription: { fontSize: 12, lineHeight: 21, color: '#8D9A83', marginTop: 10 }, detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line }, inputLabel: { fontSize: 9, letterSpacing: 1, color: '#95A089', marginTop: 25, marginBottom: 9 }, modalInput: { borderWidth: 1, borderColor: '#DEE7D5', borderRadius: 7, paddingHorizontal: 13, paddingVertical: 14, color: '#405736', fontSize: 13, marginBottom: 13, outlineWidth: 0 }, zoneOption: { padding: 16, borderWidth: 1, borderColor: '#E4EADD', borderRadius: 7, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mapScreen: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#F7F9F4' }, mapCanvas: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, mapSearchRow: { position: 'absolute', top: 14, left: 14, right: 14, alignItems: 'center', zIndex: 5 }, mapSearchBox: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 560, height: 46, borderWidth: 1, borderColor: '#DCE5D5', borderRadius: 23, paddingHorizontal: 14, gap: 8, backgroundColor: '#FFFFFF', boxShadow: '0 8px 26px #142a1926' }, searchDivider: { width: 1, height: 20, backgroundColor: '#E5EAE0' }, mapInfoCard: { position: 'absolute', top: 72, left: 14, maxWidth: '72%', backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#E4EAE0', paddingHorizontal: 12, paddingVertical: 10, zIndex: 4, boxShadow: '0 8px 26px #142a191a' }, mapInfoTitle: { fontSize: 12, fontWeight: '600', color: '#2F4229' }, mapInfoSubtitle: { fontSize: 10, color: '#7D8B74', marginTop: 4, lineHeight: 15 },
  finderSheet: { position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 8, flexDirection: 'column', backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, borderWidth: 1, borderColor: '#CFE0C5', boxShadow: '0 -10px 44px #142a1926', overflow: 'hidden' }, sheetHandlePressable: { alignItems: 'center', paddingVertical: 6, marginBottom: 4, flexShrink: 0 }, resultsScroll: { flex: 1, minHeight: 0, marginTop: 10 }, productSearchInput: { flex: 1, fontSize: 13, color: '#33462B', outlineWidth: 0, minWidth: 0, height: 34 }, productList: { borderWidth: 1, borderColor: '#EBF0E6', borderRadius: 8, overflow: 'hidden', backgroundColor: '#FFFFFF' }, productRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F4EE' }, productPinIcon: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#EEF4E8', alignItems: 'center', justifyContent: 'center' }, aislePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: '#EEF5E8' }, 
  listToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 6 },
  listCount: { color: C.green, fontWeight: '700', fontSize: 12 },
  listHint: { color: '#7D8B74', fontSize: 11, lineHeight: 16, marginTop: 3 },
  listProductName: { fontSize: 12, fontWeight: '600', color: '#2F4229' },
  listFooter: { gap: 10, paddingTop: 10 },
  productSelect: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, minHeight: 54, paddingVertical: 8 },
  addListButton: { height: 44, width: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF5E8' },
  reportPicker: { gap: 8, width: '100%', maxWidth: 560, alignSelf: 'center' }, pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, pickLabel: { width: 38, fontSize: 12, fontWeight: '700', color: '#56644D' }, pickOption: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#CFE0C5', backgroundColor: '#F7FAF4', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }, pickOptionSelected: { backgroundColor: C.green, borderColor: C.green }, pickOptionText: { fontSize: 13, fontWeight: '700', color: C.green }, reportedNote: { fontSize: 11, fontWeight: '600', color: '#8A5A24', marginTop: 2 },
  mapNotice: { position: 'absolute', left: 12, right: 12, zIndex: 8, pointerEvents: 'none', flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.dark, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, boxShadow: '0 8px 24px #142a1933' },
  mapTapOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 3 },
  locationPrompt: { position: 'absolute', left: 12, right: 12, zIndex: 6, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CFE0C5', borderRadius: 12, paddingLeft: 11, paddingRight: 5, paddingVertical: 9, boxShadow: '0 6px 20px #142a1924', pointerEvents: 'box-none' },
  locationPromptIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EDF4EE', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  locationPromptTitle: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#2E4436' },
  locationPromptText: { fontSize: 10.5, lineHeight: 15, color: '#586A54', marginTop: 2 },
  locationReset: { width: 44, height: 44, marginVertical: -5, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  foundButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.green, borderRadius: 22, minHeight: 44, paddingHorizontal: 16 },
  notHereButton: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: '#D7C4A4', backgroundColor: '#FFF8EE', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  notHereText: { color: '#8A5A24', fontSize: 13, fontWeight: '700' },
  reportStatus: { marginTop: 4, fontSize: 11, fontWeight: '700', color: '#8A5A24', textTransform: 'capitalize' },
  walkChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 7, borderWidth: 1, borderColor: '#DEE5D6', backgroundColor: '#FFF', minHeight: 40, justifyContent: 'center' },
  walkChipActive: { backgroundColor: C.green, borderColor: C.green },
  walkMapPanel: { marginTop: 18, borderWidth: 1, borderColor: '#DCE5D7', borderRadius: 12, backgroundColor: '#FBFDF9', padding: 14, gap: 12 },
  walkMapHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  walkLegendPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#EDF5EE', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 },
  walkLegendPillBlocked: { backgroundColor: '#FDF0ED' },
  walkLegendLineOpen: { width: 16, height: 3, borderRadius: 2, backgroundColor: '#2E6F4E' },
  walkLegendOpenText: { fontSize: 11, fontWeight: '600', color: '#214A35' },
  walkLegendBadgeBlocked: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#B43E2B', alignItems: 'center', justifyContent: 'center' },
  walkLegendBadgeCross: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: '#FFFFFF' },
  walkLegendBlockedText: { fontSize: 11, fontWeight: '600', color: '#8C2D1E' },
  walkMapHint: { fontSize: 11.5, color: '#4B5B45', fontWeight: '500' },
  walkMapFrame: { width: '100%', alignSelf: 'center', position: 'relative', borderRadius: 10, overflow: 'hidden', backgroundColor: '#F7F9F4' },
  walkEdgeHit: { position: 'absolute', borderRadius: 8 },
  walkEdgeHitOpenHover: { backgroundColor: '#28634722', borderWidth: 1, borderColor: '#28634766' },
  walkEdgeHitBlockedHover: { backgroundColor: '#B43E2B22', borderWidth: 1, borderColor: '#B43E2B77' },
  walkAddSection: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line, gap: 10 },
  walkListHeader: { marginTop: 18, paddingTop: 16, paddingBottom: 4, borderTopWidth: 1, borderTopColor: C.line, flexWrap: 'wrap', gap: 10 },
  completionCard: { position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 9, gap: 16, borderWidth: 1, borderColor: '#CFE0C5', borderRadius: 16, backgroundColor: '#FFFFFF', padding: 20, boxShadow: '0 -8px 30px #142a1926' },
  completionTitle: { color: C.green, fontWeight: '700', fontSize: 22 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#D6E0D0', alignSelf: 'center' },
  loginScreen: { flexGrow: 1, width: '100%', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 36, backgroundColor: C.bg },
  loginCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E4EAE0', padding: 28, boxShadow: '0 12px 36px #142a1918' },
  loginTitle: { fontSize: 24, fontWeight: '600', letterSpacing: -0.5, color: '#243528', marginTop: 22 },
  loginDescription: { fontSize: 13, lineHeight: 20, color: '#4F5F49', marginTop: 8 },
  loginFieldLabel: { fontSize: 12, fontWeight: '600', color: '#33462B', marginTop: 18, marginBottom: 7 },
  loginInput: { borderWidth: 1, borderColor: '#CFE0C5', borderRadius: 8, paddingHorizontal: 13, minHeight: 46, paddingVertical: 11, color: '#222A27', fontSize: 14, backgroundColor: '#FFFFFF', outlineWidth: 0 },
  loginActions: { gap: 10, marginTop: 22 },
  routeBanner: { position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.dark, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, boxShadow: '0 10px 30px #142a1940' }, routeTurnIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, routeInstruction: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '700', lineHeight: 20, letterSpacing: -0.2 }, routeBannerSub: { color: '#B9D4C2', fontSize: 11.5, marginTop: 3, fontWeight: '500' }, routeBar: { position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 7, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#CFE0C5', paddingHorizontal: 16, paddingVertical: 12, boxShadow: '0 -8px 30px #142a1926' }, routeBarAisle: { fontSize: 12.5, fontWeight: '700', color: C.green }, routeBarDistance: { fontSize: 19, fontWeight: '700', color: '#1D2A31', marginTop: 2, letterSpacing: -0.3 }, endButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#A03E32', borderRadius: 20, paddingHorizontal: 16, height: 40 }, endButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' }, 
});
