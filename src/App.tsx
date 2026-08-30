// App.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
    Accessibility,
    PersonStanding,
    Baby,
    Eye,
    HeartHandshake,
    Navigation,
    MapPin,
    Loader2,
    X,
    Volume2,
    VolumeX,
    LocateFixed,
    Bus,
    Footprints,
    Settings as SettingsIcon,
    AlertTriangle,
    CheckCircle2,
    ExternalLink,
    Copy,
    Check,
} from "lucide-react";

// ============================================================
// 0. 환경변수 & 로컬스토리지 API 키 관리
// ============================================================
const STORAGE_KEYS = {
    KAKAO_KEY: "careroute_kakao_key",
    TMAP_KEY: "careroute_tmap_key",
    TAGO_KEY: "careroute_tago_key",
};

export function getKakaoJsKey(): string {
    return localStorage.getItem(STORAGE_KEYS.KAKAO_KEY) || (import.meta.env.VITE_KAKAO_JS_KEY as string) || "";
}

export function getTmapAppKey(): string {
    return localStorage.getItem(STORAGE_KEYS.TMAP_KEY) || (import.meta.env.VITE_TMAP_APP_KEY as string) || "";
}

export function getTagoApiKey(): string {
    return localStorage.getItem(STORAGE_KEYS.TAGO_KEY) || (import.meta.env.VITE_TAGO_API_KEY as string) || "";
}

export function saveApiKeys(keys: { kakao?: string; tmap?: string; tago?: string }) {
    if (keys.kakao !== undefined) {
        if (keys.kakao.trim()) localStorage.setItem(STORAGE_KEYS.KAKAO_KEY, keys.kakao.trim());
        else localStorage.removeItem(STORAGE_KEYS.KAKAO_KEY);
    }
    if (keys.tmap !== undefined) {
        if (keys.tmap.trim()) localStorage.setItem(STORAGE_KEYS.TMAP_KEY, keys.tmap.trim());
        else localStorage.removeItem(STORAGE_KEYS.TMAP_KEY);
    }
    if (keys.tago !== undefined) {
        if (keys.tago.trim()) localStorage.setItem(STORAGE_KEYS.TAGO_KEY, keys.tago.trim());
        else localStorage.removeItem(STORAGE_KEYS.TAGO_KEY);
    }
}

function getTagoServiceKeyParam(): string {
    const raw = getTagoApiKey();
    if (!raw) return "";
    // If the key is already URL-encoded (%2B, %3D, etc.), pass as is; otherwise URL-encode it
    if (raw.includes("%")) {
        return raw;
    }
    return encodeURIComponent(raw);
}

declare global {
    interface Window {
        kakao: any;
    }
}

// ============================================================
// 1. 타입 정의
// ============================================================
type MobilityType = "wheelchair" | "elderly" | "stroller" | "walking_impaired" | "visually_impaired" | "general";

interface AppUser {
    id: string;
    name: string;
    mobilityType: MobilityType;
}

interface GeoPoint {
    lat: number;
    lng: number;
    name: string;
    address: string;
}

interface RouteStep {
    id: string;
    instruction: string;
    distanceMeters: number;
    durationSeconds: number;
    hasStairs: boolean;
    hasSteepSlope: boolean;
    direction: "straight" | "left" | "right" | "uturn" | "arrive";
    coord: [number, number];
}

interface RouteResult {
    steps: RouteStep[];
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    avoidedStairs: boolean;
    avoidedSlopes: boolean;
    polyline: [number, number][];
}

interface HazardZone {
    id: string;
    type: "stairs" | "steep_slope" | "narrow_sidewalk" | "crossing_difficult";
    coord: [number, number];
    radiusMeters: number;
}

interface BusStop {
    id: string;
    name: string;
    address: string;
    coord: [number, number];
    nodeId?: string;
    cityCode?: string;
}

interface BusArrivalInfo {
    busNumber: string;
    isLowFloor: boolean;
    arrivalMinutes: number;
}

interface TransitLeg {
    id: string;
    mode: "WALK" | "BUS" | "SUBWAY";
    instruction: string;
    distanceMeters: number;
    durationSeconds: number;
    routeName?: string;
    startName?: string;
    endName?: string;
    polyline: [number, number][];
}

interface TransitRouteResult {
    legs: TransitLeg[];
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    transferCount: number;
    fare?: number;
}

const HAZARD_ZONES: HazardZone[] = [
    { id: "h1", type: "stairs", coord: [33.4996, 126.5312], radiusMeters: 15 },
    { id: "h2", type: "steep_slope", coord: [33.489, 126.4983], radiusMeters: 20 },
];

/** 좌표 기준 대표 cityCode 추정 (TAGO 정류소/도착정보 연동용) */
function estimateCityCode(lat: number, lng: number): string {
    if (lat >= 33.0 && lat <= 34.0 && lng >= 126.0 && lng <= 127.2) return "39010"; // 제주
    if (lat >= 37.4 && lat <= 37.7 && lng >= 126.7 && lng <= 127.2) return "11000"; // 서울
    if (lat >= 35.0 && lat <= 35.4 && lng >= 128.8 && lng <= 129.3) return "21000"; // 부산
    if (lat >= 35.7 && lat <= 36.0 && lng >= 128.4 && lng <= 128.8) return "22000"; // 대구
    if (lat >= 37.3 && lat <= 37.6 && lng >= 126.5 && lng <= 126.8) return "23000"; // 인천
    if (lat >= 35.1 && lat <= 35.3 && lng >= 126.7 && lng <= 127.0) return "24000"; // 광주
    if (lat >= 36.2 && lat <= 36.5 && lng >= 127.2 && lng <= 127.5) return "25000"; // 대전
    if (lat >= 35.4 && lat <= 35.7 && lng >= 129.1 && lng <= 129.5) return "26000"; // 울산
    if (lat >= 36.4 && lat <= 36.7 && lng >= 127.2 && lng <= 127.4) return "36110"; // 세종
    if (lat >= 36.8 && lat <= 38.3 && lng >= 126.3 && lng <= 127.9) return "31000"; // 경기도
    return "39010"; // 기본값 (제주)
}

// ============================================================
// 2. 카카오맵 SDK 로드 및 지오코딩
// ============================================================
let sdkLoaded = false;

function loadKakaoMapSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (sdkLoaded && window.kakao?.maps) {
            resolve();
            return;
        }

        const kakaoKey = getKakaoJsKey();
        if (!kakaoKey) {
            reject(
                new Error(
                    "카카오 JavaScript 키가 설정되지 않았습니다. 상단 설정(⚙) 아이콘을 눌러 키를 입력하거나 Netlify 환경변수를 설정해주세요."
                )
            );
            return;
        }

        // 기존 스크립트 존재 시 제거 후 재로드
        const existingScript = document.getElementById("kakao-map-sdk");
        if (existingScript) {
            existingScript.remove();
        }

        const script = document.createElement("script");
        script.id = "kakao-map-sdk";
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false&libraries=services`;
        script.onload = () => {
            if (!window.kakao?.maps) {
                reject(new Error("카카오맵 객체를 찾을 수 없습니다."));
                return;
            }
            window.kakao.maps.load(() => {
                sdkLoaded = true;
                resolve();
            });
        };
        script.onerror = () => {
            const currentOrigin = window.location.origin;
            reject(
                new Error(
                    `카카오맵 SDK 로드 실패! Kakao Developers(developers.kakao.com)의 [내 애플리케이션 > 플랫폼 > Web] 사이트 도메인에 현재 주소(${currentOrigin})를 등록했는지 확인해주세요.`
                )
            );
        };
        document.head.appendChild(script);
    });
}

function geocodeAddress(query: string): Promise<GeoPoint | null> {
    return new Promise((resolve, reject) => {
        if (!window.kakao?.maps?.services) {
            reject(new Error("카카오맵 SDK가 로드되지 않았습니다."));
            return;
        }

        const geocoder = new window.kakao.maps.services.Geocoder();
        const places = new window.kakao.maps.services.Places();

        // 1. 장소 키워드 검색 우선 시도
        places.keywordSearch(query, (data: any[], placeStatus: string) => {
            if (placeStatus === window.kakao.maps.services.Status.OK && data.length > 0) {
                const first = data[0];
                resolve({
                    lat: parseFloat(first.y),
                    lng: parseFloat(first.x),
                    name: first.place_name,
                    address: first.road_address_name || first.address_name || first.place_name,
                });
            } else {
                // 2. 도로명/지번 주소 검색 시도
                geocoder.addressSearch(query, (result: any[], status: string) => {
                    if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
                        const { y, x, address_name, road_address } = result[0];
                        resolve({
                            lat: parseFloat(y),
                            lng: parseFloat(x),
                            name: query,
                            address: road_address?.address_name || address_name || query,
                        });
                    } else {
                        resolve(null);
                    }
                });
            }
        });
    });
}

function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    return new Promise((resolve) => {
        if (!window.kakao?.maps?.services) {
            resolve(null);
            return;
        }
        const geocoder = new window.kakao.maps.services.Geocoder();
        geocoder.coord2Address(lng, lat, (result: any[], status: string) => {
            if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
                const addr = result[0].road_address?.address_name || result[0].address?.address_name;
                resolve(addr || null);
            } else {
                resolve(null);
            }
        });
    });
}

// ============================================================
// 2-1. 공공데이터포털(TAGO) 버스정류소 및 도착정보 API
// ============================================================
async function fetchNearbyTagoStops(lat: number, lng: number): Promise<BusStop[]> {
    const serviceKey = getTagoServiceKeyParam();
    if (!serviceKey) {
        console.warn("TAGO API 키가 설정되지 않았습니다.");
        return [];
    }

    const defaultCityCode = estimateCityCode(lat, lng);
    const url = `/tago-api/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?serviceKey=${serviceKey}&gpsLati=${lat}&gpsLong=${lng}&_type=json&numOfRows=10`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`TAGO 정류소 API 응답 실패 (HTTP ${res.status})`);
            return [];
        }

        const text = await res.text();
        if (text.startsWith("<")) {
            console.warn("TAGO API 응답이 XML(에러) 형식입니다:", text.slice(0, 150));
            return [];
        }

        const data = JSON.parse(text);
        const items = data?.response?.body?.items?.item;
        if (!items) return [];

        const list = Array.isArray(items) ? items : [items];
        return list.map((item: any, idx: number) => ({
            id: `tago-${item.nodeid || idx}`,
            name: item.nodenm || "정류소",
            address: item.nodeid ? `정류소 ID: ${item.nodeid}` : "위치 기반 정류소",
            coord: [parseFloat(item.gpslati), parseFloat(item.gpslong)] as [number, number],
            nodeId: item.nodeid,
            cityCode: item.citycode?.toString() || defaultCityCode,
        }));
    } catch (e) {
        console.error("TAGO 정류소 조회 실패:", e);
        return [];
    }
}

async function fetchLowFloorArrivalsFromTago(stop: BusStop): Promise<BusArrivalInfo[]> {
    if (!stop.nodeId || !stop.cityCode) return [];
    const serviceKey = getTagoServiceKeyParam();
    if (!serviceKey) return [];

    const url = `/tago-api/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList?serviceKey=${serviceKey}&cityCode=${stop.cityCode}&nodeId=${stop.nodeId}&_type=json&numOfRows=20`;

    try {
        const res = await fetch(url);
        if (!res.ok) return [];

        const text = await res.text();
        if (text.startsWith("<")) {
            console.warn("TAGO 도착정보 응답이 XML(에러) 형식입니다:", text.slice(0, 150));
            return [];
        }

        const data = JSON.parse(text);
        const items = data?.response?.body?.items?.item;
        if (!items) return [];

        const list = Array.isArray(items) ? items : [items];

        return list
            .map((item: any) => ({
                busNumber: item.routeno?.toString() ?? item.routenm?.toString() ?? "",
                isLowFloor: (item.vehicletp ?? "").includes("저상") || (item.routetp ?? "").includes("저상"),
                arrivalMinutes: Math.round((item.arrtime ?? 0) / 60),
            }))
            .filter((b: BusArrivalInfo) => b.isLowFloor && b.busNumber);
    } catch (e) {
        console.error("TAGO 도착정보 조회 실패:", e);
        return [];
    }
}

// ============================================================
// 3. Tmap 보행자 경로 API
// ============================================================
function interpolateStraightLine(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number },
    segments = 10
): [number, number][] {
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        points.push([origin.lat + (dest.lat - origin.lat) * t, origin.lng + (dest.lng - origin.lng) * t]);
    }
    return points;
}

interface TmapRawResult {
    coords: [number, number][];
    stepMeta: { coord: [number, number]; description?: string }[];
    totalDistance: number;
    totalTime: number;
}

async function fetchPedestrianRoute(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number }
): Promise<TmapRawResult> {
    const tmapKey = getTmapAppKey();
    if (!tmapKey) {
        console.warn("TMAP API 키가 없습니다. 직선 경로로 표시합니다.");
        const coords = interpolateStraightLine(origin, dest);
        return { coords, stepMeta: [], totalDistance: Math.round(haversineDistance([origin.lat, origin.lng], [dest.lat, dest.lng])), totalTime: Math.round(haversineDistance([origin.lat, origin.lng], [dest.lat, dest.lng]) / 1.1) };
    }

    const payload = {
        startX: origin.lng,
        startY: origin.lat,
        endX: dest.lng,
        endY: dest.lat,
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        startName: "출발지",
        endName: "도착지",
    };

    // 프록시 경로 우선 시도 후, 실패 시 직접 엔드포인트 호출
    const endpoints = [
        "/tmap-api/tmap/routes/pedestrian?version=1",
        "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
    ];

    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    appKey: tmapKey,
                    "content-type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) continue;

            const data = await res.json();
            const features = data?.features ?? [];
            const coords: [number, number][] = [];
            const stepMeta: TmapRawResult["stepMeta"] = [];
            let totalDistance = 0;
            let totalTime = 0;

            features.forEach((f: any) => {
                const props = f.properties ?? {};
                if (props.totalDistance) totalDistance = props.totalDistance;
                if (props.totalTime) totalTime = props.totalTime;

                if (f.geometry?.type === "Point") {
                    const [lng, lat] = f.geometry.coordinates;
                    coords.push([lat, lng]);
                    stepMeta.push({ coord: [lat, lng], description: props.description });
                } else if (f.geometry?.type === "LineString") {
                    f.geometry.coordinates.forEach(([lng, lat]: [number, number]) => coords.push([lat, lng]));
                }
            });

            if (coords.length > 0) {
                return { coords, stepMeta, totalDistance, totalTime };
            }
        } catch {
            // 다음 엔드포인트 시도
        }
    }

    // fallback 직선 경로
    const fallbackCoords = interpolateStraightLine(origin, dest);
    const dist = Math.round(haversineDistance([origin.lat, origin.lng], [dest.lat, dest.lng]));
    return { coords: fallbackCoords, stepMeta: [], totalDistance: dist, totalTime: Math.round(dist / 1.1) };
}

// ============================================================
// 3-1. Tmap 대중교통(버스) 경로 API
// ============================================================
function transitModeLabel(mode: string): "WALK" | "BUS" | "SUBWAY" {
    if (mode === "WALK") return "WALK";
    if (mode === "SUBWAY") return "SUBWAY";
    return "BUS";
}

function buildTransitInstruction(mode: "WALK" | "BUS" | "SUBWAY", leg: any): string {
    if (mode === "WALK") {
        const mins = leg.sectionTime ? Math.ceil(leg.sectionTime / 60) : Math.ceil((leg.distance ?? 0) / 70);
        return `도보로 약 ${mins}분 이동하세요.`;
    }
    const routeName = leg.route || "대중교통";
    const startName = leg.start?.name || "출발 정류소";
    const endName = leg.end?.name || "도착 정류소";
    return `${startName}에서 ${routeName} 탑승 후 ${endName}에서 하차하세요.`;
}

async function fetchTransitRoute(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number }
): Promise<TransitRouteResult | null> {
    const tmapKey = getTmapAppKey();
    if (!tmapKey) return null;

    const payload = {
        startX: String(origin.lng),
        startY: String(origin.lat),
        endX: String(dest.lng),
        endY: String(dest.lat),
        count: 1,
        lang: 0,
        format: "json",
    };

    const endpoints = ["/tmap-api/transit/routes", "https://apis.openapi.sk.com/transit/routes"];

    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    appKey: tmapKey,
                    "content-type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) continue;

            const data = await res.json();
            const itineraries = data?.metaData?.plan?.itineraries;
            if (!itineraries || itineraries.length === 0) continue;

            const best = itineraries[0];
            const legs: TransitLeg[] = (best.legs ?? []).map((leg: any, idx: number) => {
                const mode = transitModeLabel(leg.mode);
                const coords: [number, number][] = (leg.passShape?.linestring || "")
                    .split(" ")
                    .filter(Boolean)
                    .map((pair: string) => {
                        const [lng, lat] = pair.split(",").map(Number);
                        return [lat, lng] as [number, number];
                    });

                return {
                    id: `leg-${idx}`,
                    mode,
                    instruction: buildTransitInstruction(mode, leg),
                    distanceMeters: leg.distance ?? 0,
                    durationSeconds: leg.sectionTime ?? 0,
                    routeName: leg.route,
                    startName: leg.start?.name,
                    endName: leg.end?.name,
                    polyline: coords.length > 0 ? coords : [[origin.lat, origin.lng], [dest.lat, dest.lng]],
                };
            });

            const transitLegCount = legs.filter((l) => l.mode === "BUS" || l.mode === "SUBWAY").length;
            const transferCount = transitLegCount > 0 ? transitLegCount - 1 : 0;

            return {
                legs,
                totalDistanceMeters: best.totalDistance ?? 0,
                totalDurationSeconds: best.totalTime ?? 0,
                transferCount: Math.max(0, transferCount),
                fare: best.fare?.regular?.totalFare,
            };
        } catch {
            // 다음 엔드포인트 시도
        }
    }

    return null;
}

// ============================================================
// 4. 위험구간 판정 + 도보 경로 조합
// ============================================================
function haversineDistance(a: [number, number], b: [number, number]): number {
    const R = 6371000;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLng = ((b[1] - a[1]) * Math.PI) / 180;
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function isNearHazard(coord: [number, number], hazards: HazardZone[], type?: HazardZone["type"]) {
    return hazards.some((h) => (!type || h.type === type) && haversineDistance(coord, h.coord) <= h.radiusMeters);
}

function buildInstruction(
    idx: number,
    total: number,
    nearStairs: boolean,
    nearSlope: boolean,
    tmapDescription: string | undefined,
    options: { avoidStairs: boolean; avoidSlopes: boolean }
): string {
    if (idx === 0) return "안내를 시작합니다. 경로를 따라 이동하세요.";
    if (idx === total - 1) return "목적지에 도착했습니다.";
    if (nearStairs && options.avoidStairs) return "주의: 이 구간에 계단이 있습니다. 우회로를 확인하세요.";
    if (nearSlope && options.avoidSlopes) return "주의: 이 구간에 급경사가 있습니다.";
    if (tmapDescription) return tmapDescription;
    return "직진하세요.";
}

async function findAccessibleRoute(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number },
    hazards: HazardZone[],
    options: { avoidStairs: boolean; avoidSlopes: boolean }
): Promise<RouteResult> {
    const { coords, stepMeta, totalDistance, totalTime } = await fetchPedestrianRoute(origin, dest);

    let avoidedStairs = true;
    let avoidedSlopes = true;

    const steps: RouteStep[] = coords.map((coord, idx) => {
        const nearStairs = isNearHazard(coord, hazards, "stairs");
        const nearSlope = isNearHazard(coord, hazards, "steep_slope");
        if (nearStairs) avoidedStairs = false;
        if (nearSlope) avoidedSlopes = false;

        const meta = stepMeta.find((m) => Math.abs(m.coord[0] - coord[0]) < 0.0001 && Math.abs(m.coord[1] - coord[1]) < 0.0001);
        const next = coords[idx + 1];
        const segmentDistance = next ? haversineDistance(coord, next) : 0;

        return {
            id: `step-${idx}`,
            instruction: buildInstruction(idx, coords.length, nearStairs, nearSlope, meta?.description, options),
            distanceMeters: Math.round(segmentDistance),
            durationSeconds: Math.round(segmentDistance / 1.1),
            hasStairs: nearStairs,
            hasSteepSlope: nearSlope,
            direction: idx === 0 ? "straight" : idx === coords.length - 1 ? "arrive" : "straight",
            coord,
        };
    });

    return {
        steps,
        totalDistanceMeters: totalDistance || steps.reduce((s, v) => s + v.distanceMeters, 0),
        totalDurationSeconds: totalTime || steps.reduce((s, v) => s + v.durationSeconds, 0),
        avoidedStairs: options.avoidStairs ? avoidedStairs : true,
        avoidedSlopes: options.avoidSlopes ? avoidedSlopes : true,
        polyline: coords,
    };
}

/** 대중교통의 도보 구간(leg)을 기존 화살표 화면이 쓰는 RouteStep[] 형태로 변환 */
function polylineToSteps(leg: TransitLeg): RouteStep[] {
    if (leg.polyline.length < 2) {
        return [
            {
                id: `${leg.id}-step-0`,
                instruction: leg.instruction,
                distanceMeters: leg.distanceMeters,
                durationSeconds: leg.durationSeconds,
                hasStairs: false,
                hasSteepSlope: false,
                direction: "straight",
                coord: leg.polyline[0] ?? [0, 0],
            },
        ];
    }

    return leg.polyline.map((coord, idx, arr) => {
        const next = arr[idx + 1];
        const segmentDistance = next ? haversineDistance(coord, next) : 0;
        return {
            id: `${leg.id}-step-${idx}`,
            instruction:
                idx === 0
                    ? "도보 구간입니다. 경로를 따라 이동하세요."
                    : idx === arr.length - 1
                        ? "이 구간의 목적지에 도착했습니다."
                        : "직진하세요.",
            distanceMeters: Math.round(segmentDistance),
            durationSeconds: Math.round(segmentDistance / 1.1),
            hasStairs: false,
            hasSteepSlope: false,
            direction: "straight",
            coord,
        };
    });
}

// ============================================================
// 5. 카카오맵 실제 지도 + 경로선 표시 (도보/대중교통 겸용)
// ============================================================
interface RouteMapViewProps {
    origin: GeoPoint | null;
    destination: GeoPoint | null;
    polylines: { coords: [number, number][]; color: string }[];
}

const RouteMapView: React.FC<RouteMapViewProps> = ({ origin, destination, polylines }) => {
    const mapDivRef = useRef<HTMLDivElement | null>(null);
    const mapObjRef = useRef<any>(null);
    const overlaysRef = useRef<any[]>([]);

    useEffect(() => {
        if (!mapDivRef.current || !window.kakao?.maps) return;

        if (!mapObjRef.current) {
            const center = origin
                ? new window.kakao.maps.LatLng(origin.lat, origin.lng)
                : new window.kakao.maps.LatLng(33.4996, 126.5312);
            mapObjRef.current = new window.kakao.maps.Map(mapDivRef.current, { center, level: 5 });
        }

        overlaysRef.current.forEach((o) => o.setMap(null));
        overlaysRef.current = [];

        const map = mapObjRef.current;
        const bounds = new window.kakao.maps.LatLngBounds();

        if (origin) {
            const pos = new window.kakao.maps.LatLng(origin.lat, origin.lng);
            const marker = new window.kakao.maps.Marker({ position: pos, map });
            overlaysRef.current.push(marker);
            bounds.extend(pos);
        }

        if (destination) {
            const pos = new window.kakao.maps.LatLng(destination.lat, destination.lng);
            const marker = new window.kakao.maps.Marker({ position: pos, map });
            overlaysRef.current.push(marker);
            bounds.extend(pos);
        }

        polylines.forEach(({ coords, color }) => {
            if (coords.length < 2) return;
            const path = coords.map(([lat, lng]) => new window.kakao.maps.LatLng(lat, lng));
            const line = new window.kakao.maps.Polyline({
                path,
                strokeWeight: 6,
                strokeColor: color,
                strokeOpacity: 0.9,
                strokeStyle: "solid",
            });
            line.setMap(map);
            overlaysRef.current.push(line);
            path.forEach((p) => bounds.extend(p));
        });

        if (!bounds.isEmpty()) {
            map.setBounds(bounds);
        }
    }, [origin, destination, polylines]);

    return <div ref={mapDivRef} style={{ width: "100%", height: "320px", borderRadius: "12px" }} />;
};

// ============================================================
// 6. 음성 안내 훅 (Web Speech API)
// ============================================================
function useVoiceGuidance(enabled: boolean) {
    const lastSpokenStepId = useRef<string | null>(null);

    const speak = useCallback(
        (text: string) => {
            if (!enabled || !("speechSynthesis" in window)) return;
            try {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = "ko-KR";
                utterance.rate = 1.0;
                window.speechSynthesis.speak(utterance);
            } catch (e) {
                console.warn("음성 안내 오류:", e);
            }
        },
        [enabled]
    );

    const speakStep = useCallback(
        (step: RouteStep, force = false) => {
            if (!force && lastSpokenStepId.current === step.id) return;
            lastSpokenStepId.current = step.id;
            const distanceText = step.distanceMeters > 0 ? `${step.distanceMeters}미터 앞, ` : "";
            speak(`${distanceText}${step.instruction}`);
        },
        [speak]
    );

    useEffect(() => () => window.speechSynthesis?.cancel(), []);

    return { speak, speakStep };
}

// ============================================================
// 7. 실시간 도보 안내 화면 (후면 카메라 배경 + 큰 화살표)
// ============================================================
function toRad(deg: number) {
    return (deg * Math.PI) / 180;
}
function toDeg(rad: number) {
    return (rad * 180) / Math.PI;
}
function calcBearing(from: [number, number], to: [number, number]): number {
    const [lat1, lng1] = from.map(toRad);
    const [lat2, lng2] = to.map(toRad);
    const dLng = lng2 - lng1;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

interface NavigationArrowViewProps {
    steps: RouteStep[];
    voiceOnDefault: boolean;
    onExit: () => void;
    overlay?: React.ReactNode;
}

const NavigationArrowView: React.FC<NavigationArrowViewProps> = ({ steps, voiceOnDefault, onExit, overlay }) => {
    const [currentIdx, setCurrentIdx] = useState(0);
    const [heading, setHeading] = useState(0);
    const [distanceRemaining, setDistanceRemaining] = useState(0);
    const [voiceOn, setVoiceOn] = useState(voiceOnDefault);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const watchIdRef = useRef<number | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const { speakStep, speak } = useVoiceGuidance(voiceOn);

    const targetStep = steps[currentIdx];

    useEffect(() => {
        async function startCamera() {
            try {
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { ideal: "environment" } },
                        audio: false,
                    });
                    streamRef.current = stream;
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                } else {
                    setCameraError("카메라를 지원하지 않는 환경입니다.");
                }
            } catch (e) {
                setCameraError("카메라를 사용할 수 없어 기본 배경으로 안내합니다.");
            }
        }
        startCamera();

        return () => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    useEffect(() => {
        setCurrentIdx(0);
    }, [steps]);

    useEffect(() => {
        if (!("geolocation" in navigator)) return;

        watchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
                const current: [number, number] = [pos.coords.latitude, pos.coords.longitude];

                let nextIdx = currentIdx;
                while (nextIdx < steps.length - 1 && haversineDistance(current, steps[nextIdx].coord) < 8) {
                    nextIdx++;
                }
                if (nextIdx !== currentIdx) setCurrentIdx(nextIdx);

                const target = steps[nextIdx];
                if (target) setDistanceRemaining(Math.round(haversineDistance(current, target.coord)));

                if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
                    setHeading(pos.coords.heading);
                } else if (target) {
                    setHeading(calcBearing(current, target.coord));
                }
            },
            (err) => console.error("위치 추적 오류:", err),
            { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
        );

        return () => {
            if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
        };
    }, [steps, currentIdx]);

    useEffect(() => {
        if (targetStep) speakStep(targetStep, true);
    }, [targetStep, speakStep]);

    useEffect(() => {
        speak("실시간 경로 안내를 시작합니다.");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!targetStep) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-hidden text-white bg-[#1A2117]">
            <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/45" />

            <div className="relative z-10 h-full flex flex-col items-center justify-between py-10 px-6">
                <div className="w-full flex items-center justify-between">
                    <button onClick={onExit} className="p-2 rounded-full bg-black/50 backdrop-blur cursor-pointer hover:bg-black/70">
                        <X className="w-6 h-6" />
                    </button>
                    <button
                        onClick={() => setVoiceOn((v) => !v)}
                        className="p-2 rounded-full bg-black/50 backdrop-blur cursor-pointer hover:bg-black/70"
                        aria-label="음성 안내 켜기/끄기"
                    >
                        {voiceOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                    </button>
                </div>

                <div className="flex-1 flex items-center justify-center">
                    <div
                        style={{ transform: `rotate(${heading}deg)`, transition: "transform 0.3s ease" }}
                        className="w-56 h-56 flex items-center justify-center"
                    >
                        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-2xl">
                            <polygon points="50,5 85,60 65,60 65,95 35,95 35,60 15,60" fill="#E9C46A" stroke="#1A2117" strokeWidth="2" />
                        </svg>
                    </div>
                </div>

                <div className="text-center space-y-2 bg-black/50 backdrop-blur rounded-2xl px-6 py-4 max-w-md w-full">
                    <p className="text-3xl font-black text-[#E9C46A]">{distanceRemaining}m</p>
                    <p className="text-lg font-bold">{targetStep.instruction}</p>
                    {(targetStep.hasStairs || targetStep.hasSteepSlope) && (
                        <p className="text-sm font-bold text-[#F4A261] bg-[#3A2A1E] px-3 py-1.5 rounded-lg inline-block">
                            ⚠ {targetStep.hasStairs ? "계단 구간 주의" : "급경사 구간 주의"}
                        </p>
                    )}
                    {cameraError && <p className="text-xs text-[#E5E0D0] opacity-80">{cameraError}</p>}
                    <button onClick={() => speak(targetStep.instruction)} className="block mx-auto mt-2 text-xs underline cursor-pointer hover:text-[#E9C46A]">
                        다시 듣기
                    </button>
                </div>
            </div>

            {overlay}
        </div>
    );
};

// ============================================================
// 7-1. 대중교통 안내 화면
// ============================================================
const modeIcon = (mode: TransitLeg["mode"]) => {
    if (mode === "WALK") return <Footprints className="w-5 h-5" />;
    return <Bus className="w-5 h-5" />;
};

interface TransitNavigationViewProps {
    legs: TransitLeg[];
    voiceOnDefault: boolean;
    onExit: () => void;
}

const TransitNavigationView: React.FC<TransitNavigationViewProps> = ({ legs, voiceOnDefault, onExit }) => {
    const [currentLegIdx, setCurrentLegIdx] = useState(0);
    const [voiceOn, setVoiceOn] = useState(voiceOnDefault);
    const { speak } = useVoiceGuidance(voiceOn);
    const currentLeg = legs[currentLegIdx];

    const goNext = useCallback(() => {
        setCurrentLegIdx((i) => Math.min(legs.length - 1, i + 1));
    }, [legs.length]);

    const goPrev = () => setCurrentLegIdx((i) => Math.max(0, i - 1));

    useEffect(() => {
        if (!currentLeg) return;
        if (currentLeg.mode !== "WALK") {
            speak(currentLeg.instruction);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentLegIdx]);

    if (!currentLeg) return null;

    if (currentLeg.mode === "WALK") {
        const nextLeg = legs[currentLegIdx + 1];
        return (
            <NavigationArrowView
                steps={polylineToSteps(currentLeg)}
                voiceOnDefault={voiceOn}
                onExit={onExit}
                overlay={
                    currentLegIdx < legs.length - 1 ? (
                        <button
                            onClick={goNext}
                            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-[#5E7153] hover:bg-[#4C5D43] text-white px-6 py-3 rounded-full text-sm font-bold shadow-lg cursor-pointer whitespace-nowrap"
                        >
                            다음 구간({nextLeg?.mode === "WALK" ? "도보" : nextLeg?.routeName || "대중교통"})으로 이동
                        </button>
                    ) : undefined
                }
            />
        );
    }

    return (
        <div className="fixed inset-0 z-50 bg-[#1A2117] text-white flex flex-col py-8 px-6">
            <div className="w-full flex items-center justify-between mb-6">
                <button onClick={onExit} className="p-2 rounded-full bg-[#2D3A29] cursor-pointer hover:bg-[#3B4C36]">
                    <X className="w-6 h-6" />
                </button>
                <button
                    onClick={() => setVoiceOn((v) => !v)}
                    className="p-2 rounded-full bg-[#2D3A29] cursor-pointer hover:bg-[#3B4C36]"
                    aria-label="음성 안내 켜기/끄기"
                >
                    {voiceOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-[#5E7153] flex items-center justify-center shadow-lg">
                    {modeIcon(currentLeg.mode)}
                </div>
                <p className="text-xs text-[#CAD6C4]">
                    구간 {currentLegIdx + 1} / {legs.length}
                </p>
                <p className="text-xl font-bold px-4">{currentLeg.instruction}</p>
                {currentLeg.routeName && <p className="text-2xl font-black text-[#E9C46A]">{currentLeg.routeName}</p>}
                <p className="text-sm text-[#CAD6C4]">
                    {Math.round(currentLeg.distanceMeters)}m · 약 {Math.ceil(currentLeg.durationSeconds / 60)}분
                </p>
                <button onClick={() => speak(currentLeg.instruction)} className="text-xs underline cursor-pointer hover:text-[#E9C46A]">
                    다시 듣기
                </button>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={goPrev}
                    disabled={currentLegIdx === 0}
                    className="flex-1 py-3 rounded-xl bg-[#2D3A29] font-bold text-sm disabled:opacity-40 cursor-pointer hover:bg-[#3B4C36]"
                >
                    이전 구간
                </button>
                {currentLegIdx < legs.length - 1 ? (
                    <button onClick={goNext} className="flex-1 py-3 rounded-xl bg-[#5E7153] font-bold text-sm cursor-pointer hover:bg-[#4C5D43]">
                        하차했어요 · 다음 구간
                    </button>
                ) : (
                    <button onClick={onExit} className="flex-1 py-3 rounded-xl bg-[#5E7153] font-bold text-sm cursor-pointer hover:bg-[#4C5D43]">
                        안내 종료 (도착)
                    </button>
                )}
            </div>
        </div>
    );
};

// ============================================================
// 8. API 키 설정 모달 (Netlify 및 런타임 설정)
// ============================================================
interface ApiKeySettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const ApiKeySettingsModal: React.FC<ApiKeySettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
    const [kakaoKey, setKakaoKey] = useState(getKakaoJsKey());
    const [tmapKey, setTmapKey] = useState(getTmapAppKey());
    const [tagoKey, setTagoKey] = useState(getTagoApiKey());
    const [copied, setCopied] = useState(false);
    const [savedMsg, setSavedMsg] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setKakaoKey(getKakaoJsKey());
            setTmapKey(getTmapAppKey());
            setTagoKey(getTagoApiKey());
            setSavedMsg(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const currentOrigin = window.location.origin;

    const handleCopyOrigin = () => {
        navigator.clipboard.writeText(currentOrigin);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSave = () => {
        saveApiKeys({ kakao: kakaoKey, tmap: tmapKey, tago: tagoKey });
        setSavedMsg(true);
        setTimeout(() => {
            onSaved();
            onClose();
        }, 800);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-[#E5E0D0] overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-[#242F20] text-white px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <SettingsIcon className="w-5 h-5 text-[#E9C46A]" />
                        <h2 className="font-bold text-base">API 설정 및 Netlify 연동 가이드</h2>
                    </div>
                    <button onClick={onClose} className="p-1 text-[#CAD6C4] hover:text-white cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-5 text-xs text-[#3B4734]">
                    {/* 카카오 도메인 등록 안내 */}
                    <div className="bg-[#F8F6F0] p-3.5 rounded-xl border border-[#E5E0D0] space-y-2">
                        <p className="font-bold text-[#2C3327] flex items-center gap-1.5">
                            <ExternalLink className="w-3.5 h-3.5 text-[#5E7153]" />
                            카카오 지도 도메인 등록 필수
                        </p>
                        <p className="text-[#6A7661] leading-relaxed">
                            카카오맵을 표시하려면 Kakao Developers 콘솔의 <strong>[플랫폼 &gt; Web &gt; 사이트 도메인]</strong>에 아래 주소를 등록해야 합니다.
                        </p>
                        <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-[#DDD7C6]">
                            <code className="flex-1 font-mono text-[#38502C] text-[11px] truncate">{currentOrigin}</code>
                            <button
                                onClick={handleCopyOrigin}
                                className="flex items-center gap-1 px-2 py-1 bg-[#EEF2E9] text-[#38502C] rounded text-[11px] font-bold hover:bg-[#E4EADF] cursor-pointer"
                            >
                                {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                                {copied ? "복사됨" : "복사"}
                            </button>
                        </div>
                    </div>

                    {/* 키 입력 폼 */}
                    <div className="space-y-3.5">
                        <div>
                            <label className="block font-bold text-[#2C3327] mb-1">
                                1. 카카오 JavaScript 키 (Kakao Maps)
                            </label>
                            <input
                                value={kakaoKey}
                                onChange={(e) => setKakaoKey(e.target.value)}
                                placeholder="예: c7eadc6d64b851b0cbe3e637fee86188"
                                className="w-full border border-[#DDD7C6] rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-[#5E7153]"
                            />
                        </div>

                        <div>
                            <label className="block font-bold text-[#2C3327] mb-1">
                                2. TMAP OpenAPI 앱 키 (보행자/대중교통 경로)
                            </label>
                            <input
                                value={tmapKey}
                                onChange={(e) => setTmapKey(e.target.value)}
                                placeholder="예: 3FSbn1oqwA9kiPIYMqpDX8sxFylsQ1s99lzJeJnp"
                                className="w-full border border-[#DDD7C6] rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-[#5E7153]"
                            />
                        </div>

                        <div>
                            <label className="block font-bold text-[#2C3327] mb-1">
                                3. 공공데이터포털 TAGO 일반 인증키 (저상버스 정보)
                            </label>
                            <input
                                value={tagoKey}
                                onChange={(e) => setTagoKey(e.target.value)}
                                placeholder="Decoding 또는 Encoding 키 입력"
                                className="w-full border border-[#DDD7C6] rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-[#5E7153]"
                            />
                            <p className="text-[10px] text-[#8C8472] mt-0.5">
                                * 공공데이터포털(data.go.kr)의 국토교통부 버스도착정보/정류소정보 API 인증키
                            </p>
                        </div>
                    </div>

                    {/* Netlify 영구 환경변수 가이드 */}
                    <div className="bg-[#EEF2E9] p-3 rounded-xl border border-[#D5DFCF] text-[#38502C] space-y-1">
                        <p className="font-bold">💡 Netlify 영구 적용 방법</p>
                        <p className="text-[11px] leading-relaxed">
                            Netlify 대시보드의 [Site configuration &gt; Environment variables]에 <code className="bg-white/80 px-1 rounded">VITE_KAKAO_JS_KEY</code>, <code className="bg-white/80 px-1 rounded">VITE_TMAP_APP_KEY</code>, <code className="bg-white/80 px-1 rounded">VITE_TAGO_API_KEY</code>를 추가하시면 빌드 시 자동 반영됩니다.
                        </p>
                    </div>
                </div>

                <div className="p-4 bg-[#FAF9F5] border-t border-[#EAE5D7] flex items-center justify-between">
                    <div>
                        {savedMsg && (
                            <span className="flex items-center gap-1 text-xs font-bold text-green-700">
                                <CheckCircle2 className="w-4 h-4" /> 저장되었습니다. 페이지를 다시 불러옵니다.
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl border border-[#DDD7C6] text-xs font-bold text-[#6A7661] hover:bg-white cursor-pointer"
                        >
                            닫기
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-5 py-2 rounded-xl bg-[#5E7153] hover:bg-[#4C5D43] text-white text-xs font-bold shadow cursor-pointer"
                        >
                            설정 저장
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================================================
// 9. 로그인 화면
// ============================================================
const MOBILITY_OPTIONS: { id: MobilityType; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "wheelchair", label: "휠체어 이용자", icon: <Accessibility className="w-6 h-6" />, desc: "계단·단차·경사로 정보 우선 안내" },
    { id: "elderly", label: "고령자", icon: <PersonStanding className="w-6 h-6" />, desc: "완만한 경로, 휴식 가능 구간 우선 안내" },
    { id: "stroller", label: "유모차 이용자", icon: <Baby className="w-6 h-6" />, desc: "경사로·엘리베이터 우선 안내" },
    { id: "visually_impaired", label: "시각장애인", icon: <Eye className="w-6 h-6" />, desc: "음성 경로 안내 자동 활성화" },
    { id: "walking_impaired", label: "보행이 어려운 이용자", icon: <HeartHandshake className="w-6 h-6" />, desc: "최소 도보거리 경로 우선 안내" },
];

interface LoginPageProps {
    onLogin: (user: AppUser) => void;
    onOpenSettings: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onOpenSettings }) => {
    const [selectedType, setSelectedType] = useState<MobilityType | null>(null);

    const canSubmit = selectedType !== null;

    const handleSubmit = () => {
        if (!canSubmit || !selectedType) return;
        onLogin({ id: `user-${Date.now()}`, name: "이용자", mobilityType: selectedType });
    };

    return (
        <div className="min-h-screen bg-[#F5F2E9] flex items-center justify-center px-4 relative">
            <button
                onClick={onOpenSettings}
                className="absolute top-4 right-4 p-2.5 rounded-full bg-white border border-[#E5E0D0] text-[#5E7153] hover:bg-[#EEF2E9] shadow-sm cursor-pointer"
                title="API 키 및 환경 설정"
            >
                <SettingsIcon className="w-5 h-5" />
            </button>

            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-[#E5E0D0] p-8 space-y-6">
                <div className="text-center space-y-1">
                    <h1 className="text-xl font-black text-[#2C3327]">무장애 이동경로 서비스</h1>
                    <p className="text-sm text-[#6A7661]">이용자 유형에 맞는 맞춤 경로를 안내해드립니다</p>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-bold text-[#3B4734]">이동 유형 선택</label>
                    {MOBILITY_OPTIONS.map((opt) => (
                        <button
                            key={opt.id}
                            onClick={() => setSelectedType(opt.id)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition cursor-pointer ${selectedType === opt.id ? "bg-[#EEF2E9] border-[#5E7153]" : "bg-white border-[#E5E0D0] hover:border-[#CCC5B2]"
                                }`}
                        >
                            <span className="text-[#5E7153]">{opt.icon}</span>
                            <div>
                                <p className="text-sm font-bold text-[#2C3327]">{opt.label}</p>
                                <p className="text-xs text-[#6A7661]">{opt.desc}</p>
                            </div>
                        </button>
                    ))}
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={`w-full py-3 rounded-xl font-bold text-sm transition cursor-pointer ${canSubmit ? "bg-[#5E7153] text-white hover:bg-[#4C5D43] shadow-md" : "bg-[#E5E0D0] text-[#9B9484] cursor-not-allowed"
                        }`}
                >
                    시작하기
                </button>
            </div>
        </div>
    );
};

// ============================================================
// 10. 저상버스 정류장 패널
// ============================================================
interface BusStopPanelProps {
    isVisuallyImpaired: boolean;
}

const BusStopPanel: React.FC<BusStopPanelProps> = ({ isVisuallyImpaired }) => {
    const [open, setOpen] = useState(false);
    const [locating, setLocating] = useState(false);
    const [loading, setLoading] = useState(false);
    const [stops, setStops] = useState<BusStop[]>([]);
    const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
    const [arrivals, setArrivals] = useState<BusArrivalInfo[]>([]);
    const [arrivalsLoading, setArrivalsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { speak } = useVoiceGuidance(isVisuallyImpaired);

    const handleToggle = async () => {
        const willOpen = !open;
        setOpen(willOpen);
        if (!willOpen) return;
        if (stops.length > 0) return;

        if (!("geolocation" in navigator)) {
            setError("이 브라우저는 위치 정보를 지원하지 않습니다.");
            return;
        }

        setLocating(true);
        setError(null);

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                setLocating(false);
                setLoading(true);
                const result = await fetchNearbyTagoStops(pos.coords.latitude, pos.coords.longitude);
                setStops(result);
                setLoading(false);
                if (result.length === 0) {
                    setError("주변 정류장 정보를 찾지 못했거나 TAGO API 키를 확인해주세요.");
                }
                if (isVisuallyImpaired) {
                    speak(result.length > 0 ? `주변 정류장 ${result.length}곳을 찾았습니다.` : "주변에서 정류장을 찾지 못했습니다.");
                }
            },
            (err) => {
                setLocating(false);
                console.warn("위치 정보 가져오기 실패:", err);
                setError("현재 위치를 가져올 수 없습니다. 브라우저 위치 권한을 허용해주세요.");
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    const handleSelectStop = async (stop: BusStop) => {
        setSelectedStop(stop);
        setArrivalsLoading(true);
        const result = await fetchLowFloorArrivalsFromTago(stop);
        setArrivals(result);
        setArrivalsLoading(false);
        if (isVisuallyImpaired) {
            speak(
                result.length > 0
                    ? `${stop.name} 저상버스 ${result.length}건 있습니다.`
                    : `${stop.name}에 현재 예정된 저상버스가 없습니다.`
            );
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-[#E5E0D0] overflow-hidden">
            <button
                onClick={handleToggle}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-bold text-[#2C3327] cursor-pointer hover:bg-[#FAF9F5] transition"
            >
                <span className="flex items-center gap-2">
                    <Bus className="w-4 h-4 text-[#5E7153]" />
                    주변 저상버스 정류장 보기
                </span>
                <span className="text-xs text-[#6A7661]">{open ? "접기 ▲" : "펼치기 ▼"}</span>
            </button>

            {open && (
                <div className="px-4 pb-4 space-y-2 border-t border-[#EAE5D7] pt-3">
                    {locating && (
                        <p className="text-xs text-[#6A7661] flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 현재 위치 확인 중...
                        </p>
                    )}
                    {loading && (
                        <p className="text-xs text-[#6A7661] flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 주변 정류장 검색 중...
                        </p>
                    )}
                    {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
                    {!loading && !locating && stops.length === 0 && !error && (
                        <p className="text-xs text-[#9B9484]">주변에서 정류장을 찾지 못했습니다.</p>
                    )}
                    {!loading &&
                        stops.map((stop) => (
                            <button
                                key={stop.id}
                                onClick={() => handleSelectStop(stop)}
                                className={`w-full text-left p-2.5 rounded-xl border text-xs cursor-pointer ${selectedStop?.id === stop.id ? "border-[#5E7153] bg-[#EEF2E9]" : "border-[#E5E0D0] hover:bg-[#FAF9F5]"
                                    }`}
                            >
                                <p className="font-bold text-[#2C3327]">{stop.name}</p>
                                <p className="text-[#6A7661]">{stop.address}</p>
                            </button>
                        ))}
                    {selectedStop && (
                        <div className="mt-2 p-3 bg-[#FAF9F5] rounded-xl border border-[#EAE5D7] space-y-1.5">
                            <p className="text-xs font-bold text-[#2C3327]">{selectedStop.name} — 저상버스 도착 정보</p>
                            {arrivalsLoading && <p className="text-xs text-[#6A7661]">불러오는 중...</p>}
                            {!arrivalsLoading && arrivals.length === 0 && (
                                <p className="text-xs text-[#9B9484]">현재 예정된 저상버스가 없습니다.</p>
                            )}
                            {!arrivalsLoading &&
                                arrivals.map((a, i) => (
                                    <div key={i} className="flex justify-between text-xs bg-white px-2.5 py-1.5 rounded-lg border border-[#E5E0D0]">
                                        <span className="font-bold text-[#38502C]">{a.busNumber}번 (저상)</span>
                                        <span className="text-[#6A7661]">{a.arrivalMinutes}분 후 도착</span>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ============================================================
// 11. 대중교통 경로 요약 카드
// ============================================================
interface TransitSummaryCardProps {
    result: TransitRouteResult;
    onStartNavigation: () => void;
}

const TransitSummaryCard: React.FC<TransitSummaryCardProps> = ({ result, onStartNavigation }) => {
    return (
        <div className="bg-white rounded-2xl border border-[#E5E0D0] p-4 space-y-3">
            <div className="flex justify-between text-sm font-bold text-[#2C3327]">
                <span>예상 거리: {(result.totalDistanceMeters / 1000).toFixed(2)}km</span>
                <span>예상 시간: {Math.ceil(result.totalDurationSeconds / 60)}분</span>
            </div>
            <div className="flex gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-[#E4EADF] text-[#38502C]">환승 {result.transferCount}회</span>
                {result.fare != null && <span className="px-2 py-1 rounded bg-[#E4EADF] text-[#38502C]">요금 {result.fare.toLocaleString()}원</span>}
            </div>

            <div className="space-y-1.5">
                {result.legs.map((leg) => (
                    <div key={leg.id} className="flex items-center gap-2 text-xs bg-[#FAF9F5] p-2 rounded-lg border border-[#EAE5D7]">
                        <span className="text-[#5E7153]">{modeIcon(leg.mode)}</span>
                        <span className="flex-1 text-[#3B4734]">
                            {leg.mode === "WALK" ? "도보" : leg.routeName || "대중교통"}
                            {leg.startName && leg.endName ? ` (${leg.startName} → ${leg.endName})` : ""}
                        </span>
                        <span className="text-[#9B9484]">{Math.ceil(leg.durationSeconds / 60)}분</span>
                    </div>
                ))}
            </div>

            <button
                onClick={onStartNavigation}
                className="w-full bg-[#242F20] hover:bg-[#1A2117] text-white py-3 rounded-xl text-sm font-bold cursor-pointer transition shadow-md"
            >
                실시간 경로 안내 시작
            </button>
        </div>
    );
};

// ============================================================
// 12. 경로 검색 페이지 (도보 / 대중교통 탭 전환)
// ============================================================
interface RouteSearchPageProps {
    user: AppUser;
    onOpenSettings: () => void;
}

type TravelMode = "walk" | "transit";

const RouteSearchPage: React.FC<RouteSearchPageProps> = ({ user, onOpenSettings }) => {
    const [sdkReady, setSdkReady] = useState(false);
    const [originText, setOriginText] = useState("");
    const [destinationText, setDestinationText] = useState("");
    const [originGeo, setOriginGeo] = useState<GeoPoint | null>(null);
    const [destGeo, setDestGeo] = useState<GeoPoint | null>(null);
    const [avoidStairs, setAvoidStairs] = useState(true);
    const [avoidSlopes, setAvoidSlopes] = useState(true);
    const [travelMode, setTravelMode] = useState<TravelMode>("walk");
    const [loading, setLoading] = useState(false);
    const [locating, setLocating] = useState(false);
    const [walkRoute, setWalkRoute] = useState<RouteResult | null>(null);
    const [transitRoute, setTransitRoute] = useState<TransitRouteResult | null>(null);
    const [navigatingWalk, setNavigatingWalk] = useState(false);
    const [navigatingTransit, setNavigatingTransit] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isVisuallyImpaired = user.mobilityType === "visually_impaired";
    const { speak } = useVoiceGuidance(isVisuallyImpaired);

    const initKakao = useCallback(() => {
        setError(null);
        loadKakaoMapSdk()
            .then(() => {
                setSdkReady(true);
                if (isVisuallyImpaired) speak("무장애 경로 탐색 화면입니다. 출발지와 도착지를 입력해주세요.");
            })
            .catch((e) => {
                console.error("카카오맵 SDK 초기화 실패:", e);
                setError(e.message);
            });
    }, [isVisuallyImpaired, speak]);

    useEffect(() => {
        initKakao();
    }, [initKakao]);

    const handleUseCurrentLocation = () => {
        if (!("geolocation" in navigator)) {
            setError("이 브라우저는 위치 정보를 지원하지 않습니다.");
            return;
        }
        setLocating(true);
        setError(null);

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const addr = (await reverseGeocode(lat, lng)) || "현재 위치";
                setOriginText(addr);
                setOriginGeo({ lat, lng, name: "현재 위치", address: addr });
                setLocating(false);
                if (isVisuallyImpaired) speak("현재 위치를 출발지로 설정했습니다.");
            },
            () => {
                setError("현재 위치를 가져올 수 없습니다. 브라우저 위치 권한을 확인해주세요.");
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    const handleSearch = async () => {
        if (!destinationText || (!originText && !originGeo)) {
            setError("출발지와 도착지를 모두 입력해주세요.");
            return;
        }
        setLoading(true);
        setError(null);
        setWalkRoute(null);
        setTransitRoute(null);

        try {
            const oGeo = originGeo && originText === originGeo.address ? originGeo : await geocodeAddress(originText);
            const dGeo = await geocodeAddress(destinationText);

            if (!oGeo || !dGeo) {
                setError("출발지 또는 도착지를 찾을 수 없습니다. 정확한 장소명이나 도로명 주소를 입력해주세요.");
                if (isVisuallyImpaired) speak("출발지 또는 도착지를 찾을 수 없습니다.");
                return;
            }
            setOriginGeo(oGeo);
            setDestGeo(dGeo);

            if (travelMode === "walk") {
                const result = await findAccessibleRoute(oGeo, dGeo, HAZARD_ZONES, {
                    avoidStairs,
                    avoidSlopes: avoidSlopes || user.mobilityType === "wheelchair" || user.mobilityType === "stroller",
                });
                setWalkRoute(result);
                if (isVisuallyImpaired) {
                    speak(
                        `도보 경로를 찾았습니다. 약 ${(result.totalDistanceMeters / 1000).toFixed(1)}킬로미터, ${Math.ceil(
                            result.totalDurationSeconds / 60
                        )}분 소요됩니다.`
                    );
                }
            } else {
                const result = await fetchTransitRoute(oGeo, dGeo);
                if (!result) {
                    setError("대중교통 경로를 찾을 수 없습니다. 도보 경로를 이용하거나 API 설정을 확인해주세요.");
                    if (isVisuallyImpaired) speak("대중교통 경로를 찾을 수 없습니다.");
                    return;
                }
                setTransitRoute(result);
                if (isVisuallyImpaired) {
                    speak(
                        `대중교통 경로를 찾았습니다. 환승 ${result.transferCount}회, 약 ${Math.ceil(
                            result.totalDurationSeconds / 60
                        )}분 소요됩니다.`
                    );
                }
            }
        } catch (e: any) {
            setError(e.message || "경로 탐색 중 오류가 발생했습니다.");
            if (isVisuallyImpaired) speak("경로 탐색 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    if (navigatingWalk && walkRoute) {
        return (
            <NavigationArrowView
                steps={walkRoute.steps}
                voiceOnDefault={isVisuallyImpaired}
                onExit={() => setNavigatingWalk(false)}
            />
        );
    }

    if (navigatingTransit && transitRoute) {
        return (
            <TransitNavigationView
                legs={transitRoute.legs}
                voiceOnDefault={isVisuallyImpaired}
                onExit={() => setNavigatingTransit(false)}
            />
        );
    }

    const mapPolylines =
        travelMode === "walk"
            ? walkRoute
                ? [{ coords: walkRoute.polyline, color: "#5E7153" }]
                : []
            : transitRoute
                ? transitRoute.legs.map((leg) => ({
                    coords: leg.polyline,
                    color: leg.mode === "WALK" ? "#9B9484" : "#5E7153",
                }))
                : [];

    return (
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            {/* 상단 헤더 */}
            <div className="bg-[#242F20] rounded-2xl p-5 text-[#FAF8F2] flex items-center justify-between shadow-sm">
                <div>
                    <p className="text-xs text-[#CAD6C4]">
                        {user.mobilityType === "wheelchair" && "휠체어 모드 안내"}
                        {user.mobilityType === "elderly" && "고령자 안심 모드 안내"}
                        {user.mobilityType === "stroller" && "유모차 친화 모드 안내"}
                        {user.mobilityType === "visually_impaired" && "시각장애인 음성 모드 안내"}
                        {user.mobilityType === "walking_impaired" && "보행약자 단축경로 모드 안내"}
                        {user.mobilityType === "general" && "무장애 이동경로 안내"}
                    </p>
                    <h1 className="text-lg font-black mt-1">무장애 맞춤 경로 탐색</h1>
                </div>
                <button
                    onClick={onOpenSettings}
                    className="p-2.5 rounded-xl bg-[#2D3A29] hover:bg-[#38502C] text-[#E9C46A] cursor-pointer transition flex items-center gap-1.5 text-xs font-bold"
                    title="API 설정 및 연동 상태"
                >
                    <SettingsIcon className="w-4 h-4" />
                    <span>설정</span>
                </button>
            </div>

            {/* API 키 상태 또는 에러 배너 */}
            {error && (
                <div className="bg-[#FDF2F2] border border-[#F8B4B4] rounded-2xl p-4 text-xs text-[#9B3A3A] space-y-2">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-[#9B3A3A] shrink-0 mt-0.5" />
                        <p className="font-bold">{error}</p>
                    </div>
                    <button
                        onClick={onOpenSettings}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-[#9B3A3A] underline hover:text-black cursor-pointer"
                    >
                        API 키 설정창 열기 &gt;
                    </button>
                </div>
            )}

            {/* 주변 저상버스 정류장 패널 */}
            <BusStopPanel isVisuallyImpaired={isVisuallyImpaired} />

            {/* 경로 검색 입력 카드 */}
            <div className="bg-white rounded-2xl border border-[#E5E0D0] p-4 space-y-3 shadow-xs">
                <div className="flex gap-2">
                    <button
                        onClick={() => setTravelMode("walk")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold cursor-pointer transition ${travelMode === "walk" ? "bg-[#5E7153] text-white shadow-sm" : "bg-[#F4F7F1] text-[#3B4734] hover:bg-[#EEF2E9]"
                            }`}
                    >
                        <Footprints className="w-4 h-4" />
                        도보로 가기
                    </button>
                    <button
                        onClick={() => setTravelMode("transit")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold cursor-pointer transition ${travelMode === "transit" ? "bg-[#5E7153] text-white shadow-sm" : "bg-[#F4F7F1] text-[#3B4734] hover:bg-[#EEF2E9]"
                            }`}
                    >
                        <Bus className="w-4 h-4" />
                        버스 타고 가기
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 border border-[#DDD7C6] rounded-xl px-3 py-2.5 focus-within:border-[#5E7153]">
                        <MapPin className="w-4 h-4 text-[#5E7153] shrink-0" />
                        <input
                            value={originText}
                            onChange={(e) => {
                                setOriginText(e.target.value);
                                setOriginGeo(null);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            placeholder="출발지 입력 (예: 강남역, 제주시청)"
                            className="w-full text-sm outline-none"
                        />
                    </div>
                    <button
                        onClick={handleUseCurrentLocation}
                        disabled={locating}
                        className="flex items-center gap-1 px-3 py-2.5 rounded-xl border border-[#DDD7C6] text-xs font-bold text-[#38502C] bg-[#F4F7F1] hover:bg-[#EEF2E9] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                        {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
                        현재 위치
                    </button>
                </div>

                <div className="flex items-center gap-2 border border-[#DDD7C6] rounded-xl px-3 py-2.5 focus-within:border-[#5E7153]">
                    <Navigation className="w-4 h-4 text-[#5E7153] shrink-0" />
                    <input
                        value={destinationText}
                        onChange={(e) => setDestinationText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        placeholder="도착지 입력 (예: 코엑스, 탑동광장)"
                        className="w-full text-sm outline-none"
                    />
                </div>

                {travelMode === "walk" && (
                    <div className="flex gap-3 text-xs pt-1">
                        <label className="flex items-center gap-1.5 cursor-pointer text-[#3B4734]">
                            <input
                                type="checkbox"
                                checked={avoidStairs}
                                onChange={(e) => setAvoidStairs(e.target.checked)}
                                className="accent-[#5E7153]"
                            />
                            계단 제외
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-[#3B4734]">
                            <input
                                type="checkbox"
                                checked={avoidSlopes}
                                onChange={(e) => setAvoidSlopes(e.target.checked)}
                                className="accent-[#5E7153]"
                            />
                            급경사 제외
                        </label>
                    </div>
                )}

                <button
                    onClick={handleSearch}
                    disabled={loading}
                    className="w-full bg-[#5E7153] hover:bg-[#4C5D43] text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-md transition"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {loading ? "경로 탐색 중..." : "무장애 경로 찾기"}
                </button>
            </div>

            {/* 지도 뷰 */}
            {sdkReady && (
                <div className="bg-white rounded-2xl border border-[#E5E0D0] p-3 shadow-xs">
                    <RouteMapView origin={originGeo} destination={destGeo} polylines={mapPolylines} />
                </div>
            )}

            {/* 도보 경로 결과 요약 */}
            {travelMode === "walk" && walkRoute && (
                <div className="bg-white rounded-2xl border border-[#E5E0D0] p-4 space-y-3 shadow-xs">
                    <div className="flex justify-between text-sm font-bold text-[#2C3327]">
                        <span>예상 거리: {(walkRoute.totalDistanceMeters / 1000).toFixed(2)}km</span>
                        <span>예상 시간: {Math.ceil(walkRoute.totalDurationSeconds / 60)}분</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                        <span className={`px-2 py-1 rounded ${walkRoute.avoidedStairs ? "bg-[#E4EADF] text-[#38502C]" : "bg-[#FBEAEA] text-[#9B3A3A]"}`}>
                            {walkRoute.avoidedStairs ? "✔ 계단 없음" : "⚠ 계단 포함"}
                        </span>
                        <span className={`px-2 py-1 rounded ${walkRoute.avoidedSlopes ? "bg-[#E4EADF] text-[#38502C]" : "bg-[#FBEAEA] text-[#9B3A3A]"}`}>
                            {walkRoute.avoidedSlopes ? "✔ 급경사 없음" : "⚠ 급경사 포함"}
                        </span>
                    </div>

                    {isVisuallyImpaired && (
                        <p className="text-xs text-[#5E7153] bg-[#EEF2E9] p-2 rounded-lg">
                            시각장애인 모드: 안내 시작 시 음성 안내가 함께 제공됩니다.
                        </p>
                    )}

                    <button
                        onClick={() => setNavigatingWalk(true)}
                        className="w-full bg-[#242F20] hover:bg-[#1A2117] text-white py-3 rounded-xl text-sm font-bold cursor-pointer transition shadow-md"
                    >
                        실시간 경로 안내 시작
                    </button>
                </div>
            )}

            {/* 대중교통 경로 결과 요약 */}
            {travelMode === "transit" && transitRoute && (
                <TransitSummaryCard result={transitRoute} onStartNavigation={() => setNavigatingTransit(true)} />
            )}
        </div>
    );
};

// ============================================================
// 13. 최상위 App 컴포넌트
// ============================================================
export default function App() {
    const [user, setUser] = useState<AppUser | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleReloadOnKeySave = () => {
        window.location.reload();
    };

    return (
        <div className="min-h-screen bg-[#F5F2E9]">
            {!user ? (
                <LoginPage onLogin={setUser} onOpenSettings={() => setSettingsOpen(true)} />
            ) : (
                <RouteSearchPage user={user} onOpenSettings={() => setSettingsOpen(true)} />
            )}

            <ApiKeySettingsModal
                isOpen={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onSaved={handleReloadOnKeySave}
            />
        </div>
    );
}