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
} from "lucide-react";

// ============================================================
// 0. 환경변수
// ============================================================
const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY as string;
const TMAP_APP_KEY = import.meta.env.VITE_TMAP_APP_KEY as string;
const TAGO_API_KEY = import.meta.env.VITE_TAGO_API_KEY as string;

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

const JEJU_CITY_CODE = "39010";

// ============================================================
// 2. 카카오맵 SDK
// ============================================================
let sdkLoaded = false;

function loadKakaoMapSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (sdkLoaded && window.kakao?.maps) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
        script.onload = () => {
            window.kakao.maps.load(() => {
                sdkLoaded = true;
                resolve();
            });
        };
        script.onerror = () => reject(new Error("카카오맵 SDK 로드 실패"));
        document.head.appendChild(script);
    });
}

function geocodeAddress(query: string): Promise<GeoPoint | null> {
    return new Promise((resolve, reject) => {
        if (!window.kakao?.maps?.services) {
            reject(new Error("카카오맵 SDK가 아직 로드되지 않았습니다."));
            return;
        }
        const geocoder = new window.kakao.maps.services.Geocoder();
        geocoder.addressSearch(query, (result: any[], status: string) => {
            if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
                const { y, x, address_name } = result[0];
                resolve({ lat: parseFloat(y), lng: parseFloat(x), name: query, address: address_name });
            } else {
                const places = new window.kakao.maps.services.Places();
                places.keywordSearch(query, (data: any[], placeStatus: string) => {
                    if (placeStatus === window.kakao.maps.services.Status.OK && data.length > 0) {
                        resolve({
                            lat: parseFloat(data[0].y),
                            lng: parseFloat(data[0].x),
                            name: data[0].place_name,
                            address: data[0].road_address_name || data[0].address_name,
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

async function fetchNearbyTagoStops(lat: number, lng: number): Promise<BusStop[]> {
    const url = `/tago-api/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?serviceKey=${TAGO_API_KEY}&gpsLati=${lat}&gpsLong=${lng}&_type=json&numOfRows=10`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        const items = data?.response?.body?.items?.item;
        if (!items) return [];

        const list = Array.isArray(items) ? items : [items];
        return list.map((item: any, idx: number) => ({
            id: `tago-${item.nodeid || idx}`,
            name: item.nodenm,
            address: `정류소 ID: ${item.nodeid}`,
            coord: [parseFloat(item.gpslati), parseFloat(item.gpslong)] as [number, number],
            nodeId: item.nodeid,
            cityCode: item.citycode || JEJU_CITY_CODE,
        }));
    } catch (e) {
        console.error("TAGO 정류소 조회 실패:", e);
        return [];
    }
}

async function fetchLowFloorArrivalsFromTago(stop: BusStop): Promise<BusArrivalInfo[]> {
    if (!stop.nodeId || !stop.cityCode) return [];

    const url = `/tago-api/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList?serviceKey=${TAGO_API_KEY}&cityCode=${stop.cityCode}&nodeId=${stop.nodeId}&_type=json&numOfRows=20`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        const items = data?.response?.body?.items?.item;
        if (!items) return [];

        const list = Array.isArray(items) ? items : [items];

        return list
            .map((item: any) => ({
                busNumber: item.routeno?.toString() ?? "",
                isLowFloor: (item.vehicletp ?? "").includes("저상"),
                arrivalMinutes: Math.round((item.arrtime ?? 0) / 60),
            }))
            .filter((b: BusArrivalInfo) => b.isLowFloor);
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
    try {
        const res = await fetch("https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1", {
            method: "POST",
            headers: { accept: "application/json", appKey: TMAP_APP_KEY, "content-type": "application/json" },
            body: JSON.stringify({
                startX: origin.lng,
                startY: origin.lat,
                endX: dest.lng,
                endY: dest.lat,
                startName: "출발",
                endName: "도착",
            }),
        });

        if (!res.ok) throw new Error(`Tmap API 오류: ${res.status}`);

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

            if (f.geometry.type === "Point") {
                const [lng, lat] = f.geometry.coordinates;
                coords.push([lat, lng]);
                stepMeta.push({ coord: [lat, lng], description: props.description });
            } else if (f.geometry.type === "LineString") {
                f.geometry.coordinates.forEach(([lng, lat]: [number, number]) => coords.push([lat, lng]));
            }
        });

        if (coords.length === 0) throw new Error("경로 좌표 없음");
        return { coords, stepMeta, totalDistance, totalTime };
    } catch {
        return { coords: interpolateStraightLine(origin, dest), stepMeta: [], totalDistance: 0, totalTime: 0 };
    }
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
        return `도보로 ${leg.sectionTime ? Math.round(leg.sectionTime / 60) : ""}분 이동하세요.`;
    }
    const routeName = leg.route || "노선 정보 없음";
    const startName = leg.start?.name || "";
    const endName = leg.end?.name || "";
    return `${startName}에서 ${routeName} 탑승 후 ${endName}에서 하차하세요.`;
}

async function fetchTransitRoute(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number }
): Promise<TransitRouteResult | null> {
    try {
        const res = await fetch("https://apis.openapi.sk.com/transit/routes", {
            method: "POST",
            headers: { accept: "application/json", appKey: TMAP_APP_KEY, "content-type": "application/json" },
            body: JSON.stringify({
                startX: String(origin.lng),
                startY: String(origin.lat),
                endX: String(dest.lng),
                endY: String(dest.lat),
                count: 1,
                lang: 0,
                format: "json",
            }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        const itineraries = data?.metaData?.plan?.itineraries;
        if (!itineraries || itineraries.length === 0) return null;

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
                polyline: coords,
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
    } catch (e) {
        console.error("Tmap 대중교통 경로 조회 실패:", e);
        return null;
    }
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

        const meta = stepMeta.find((m) => m.coord[0] === coord[0] && m.coord[1] === coord[1]);
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
// 6. 음성 안내 훅
// ============================================================
function useVoiceGuidance(enabled: boolean) {
    const lastSpokenStepId = useRef<string | null>(null);

    const speak = useCallback(
        (text: string) => {
            if (!enabled || !("speechSynthesis" in window)) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = "ko-KR";
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
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
// 7. 실시간 도보 안내 화면 (후면 카메라 배경 + 큰 화살표) — 단독 사용 & 대중교통 도보구간 공용
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
    overlay?: React.ReactNode; // 대중교통 흐름에서 화살표 화면 위에 겹쳐 보일 버튼 등
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
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" } },
                    audio: false,
                });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (e) {
                setCameraError("카메라를 사용할 수 없어 배경 없이 안내합니다.");
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
        <div className="fixed inset-0 z-50 overflow-hidden text-white">
            <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/45" />

            <div className="relative z-10 h-full flex flex-col items-center justify-between py-10 px-6">
                <div className="w-full flex items-center justify-between">
                    <button onClick={onExit} className="p-2 rounded-full bg-black/50 backdrop-blur cursor-pointer">
                        <X className="w-6 h-6" />
                    </button>
                    <button
                        onClick={() => setVoiceOn((v) => !v)}
                        className="p-2 rounded-full bg-black/50 backdrop-blur cursor-pointer"
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

                <div className="text-center space-y-2 bg-black/40 backdrop-blur rounded-2xl px-6 py-4">
                    <p className="text-3xl font-black">{distanceRemaining}m</p>
                    <p className="text-lg">{targetStep.instruction}</p>
                    {(targetStep.hasStairs || targetStep.hasSteepSlope) && (
                        <p className="text-sm font-bold text-[#F4A261] bg-[#3A2A1E] px-3 py-1.5 rounded-lg inline-block">
                            ⚠ {targetStep.hasStairs ? "계단 구간" : "급경사 구간"}
                        </p>
                    )}
                    {cameraError && <p className="text-xs text-[#F4A261]">{cameraError}</p>}
                    <button onClick={() => speak(targetStep.instruction)} className="block mx-auto mt-2 text-xs underline cursor-pointer">
                        다시 듣기
                    </button>
                </div>
            </div>

            {overlay}
        </div>
    );
};

// ============================================================
// 7-1. 대중교통 안내 화면 (도보 구간=기존 화살표 재사용 / 버스 구간=탑승 안내 카드)
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

    // 도보 구간: 기존 화살표+GPS 안내 화면을 그대로 재사용
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
                            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-[#5E7153] text-white px-6 py-3 rounded-full text-sm font-bold shadow-lg cursor-pointer whitespace-nowrap"
                        >
                            다음 구간({nextLeg.mode === "WALK" ? "도보" : nextLeg.routeName || "대중교통"})으로 이동
                        </button>
                    ) : undefined
                }
            />
        );
    }

    // 버스/지하철 구간: 화살표 대신 탑승 안내 카드
    return (
        <div className="fixed inset-0 z-50 bg-[#1A2117] text-white flex flex-col py-8 px-6">
            <div className="w-full flex items-center justify-between mb-6">
                <button onClick={onExit} className="p-2 rounded-full bg-[#2D3A29] cursor-pointer">
                    <X className="w-6 h-6" />
                </button>
                <button
                    onClick={() => setVoiceOn((v) => !v)}
                    className="p-2 rounded-full bg-[#2D3A29] cursor-pointer"
                    aria-label="음성 안내 켜기/끄기"
                >
                    {voiceOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-[#5E7153] flex items-center justify-center">
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
                <button onClick={() => speak(currentLeg.instruction)} className="text-xs underline cursor-pointer">
                    다시 듣기
                </button>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={goPrev}
                    disabled={currentLegIdx === 0}
                    className="flex-1 py-3 rounded-xl bg-[#2D3A29] font-bold text-sm disabled:opacity-40 cursor-pointer"
                >
                    이전 구간
                </button>
                {currentLegIdx < legs.length - 1 ? (
                    <button onClick={goNext} className="flex-1 py-3 rounded-xl bg-[#5E7153] font-bold text-sm cursor-pointer">
                        하차했어요 · 다음 구간
                    </button>
                ) : (
                    <button onClick={onExit} className="flex-1 py-3 rounded-xl bg-[#5E7153] font-bold text-sm cursor-pointer">
                        안내 종료 (도착)
                    </button>
                )}
            </div>
        </div>
    );
};

// ============================================================
// 8. 로그인 화면
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
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
    const [selectedType, setSelectedType] = useState<MobilityType | null>(null);

    const canSubmit = selectedType !== null;

    const handleSubmit = () => {
        if (!canSubmit || !selectedType) return;
        onLogin({ id: `user-${Date.now()}`, name: "이용자", mobilityType: selectedType });
    };

    return (
        <div className="min-h-screen bg-[#F5F2E9] flex items-center justify-center px-4">
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
                    className={`w-full py-3 rounded-xl font-bold text-sm transition cursor-pointer ${canSubmit ? "bg-[#5E7153] text-white hover:bg-[#4C5D43]" : "bg-[#E5E0D0] text-[#9B9484] cursor-not-allowed"
                        }`}
                >
                    시작하기
                </button>
            </div>
        </div>
    );
};

// ============================================================
// 9. 저상버스 정류장 패널
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
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                setLocating(false);
                setLoading(true);
                const result = await fetchNearbyTagoStops(pos.coords.latitude, pos.coords.longitude);
                setStops(result);
                setLoading(false);
                if (isVisuallyImpaired) {
                    speak(result.length > 0 ? `주변 정류장 ${result.length}곳을 찾았습니다.` : "주변에서 정류장을 찾지 못했습니다.");
                }
            },
            () => {
                setLocating(false);
                setError("현재 위치를 가져올 수 없습니다. 위치 권한을 확인해주세요.");
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
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    {!loading && !locating && stops.length === 0 && !error && (
                        <p className="text-xs text-[#9B9484]">주변에서 정류장을 찾지 못했습니다.</p>
                    )}
                    {!loading &&
                        stops.map((stop) => (
                            <button
                                key={stop.id}
                                onClick={() => handleSelectStop(stop)}
                                className={`w-full text-left p-2.5 rounded-xl border text-xs cursor-pointer ${selectedStop?.id === stop.id ? "border-[#5E7153] bg-[#EEF2E9]" : "border-[#E5E0D0]"
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
// 10. 대중교통 경로 요약 카드
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
                {result.fare != null && <span className="px-2 py-1 rounded bg-[#E4EADF] text-[#38502C]">요금 {result.fare}원</span>}
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
                className="w-full bg-[#242F20] text-white py-3 rounded-xl text-sm font-bold cursor-pointer"
            >
                실시간 경로 안내 시작
            </button>
        </div>
    );
};

// ============================================================
// 11. 경로 검색 페이지 (도보 / 대중교통 탭 전환)
// ============================================================
interface RouteSearchPageProps {
    user: AppUser;
}

type TravelMode = "walk" | "transit";

const RouteSearchPage: React.FC<RouteSearchPageProps> = ({ user }) => {
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

    useEffect(() => {
        loadKakaoMapSdk()
            .then(() => {
                setSdkReady(true);
                if (isVisuallyImpaired) speak("무장애 경로 탐색 화면입니다. 출발지와 도착지를 입력해주세요.");
            })
            .catch((e) => setError(e.message));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleUseCurrentLocation = () => {
        if (!("geolocation" in navigator)) {
            setError("이 브라우저는 위치 정보를 지원하지 않습니다.");
            return;
        }
        setLocating(true);
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
                setError("현재 위치를 가져올 수 없습니다. 위치 권한을 확인해주세요.");
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    const handleSearch = async () => {
        if (!destinationText || (!originText && !originGeo)) return;
        setLoading(true);
        setError(null);
        setWalkRoute(null);
        setTransitRoute(null);

        try {
            const oGeo = originGeo && originText === originGeo.address ? originGeo : await geocodeAddress(originText);
            const dGeo = await geocodeAddress(destinationText);

            if (!oGeo || !dGeo) {
                setError("출발지 또는 도착지를 찾을 수 없습니다. 정확한 주소나 장소명을 입력해주세요.");
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
                    setError("대중교통 경로를 찾을 수 없습니다. 도보 경로를 이용해주세요.");
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
            <div className="bg-[#242F20] rounded-2xl p-5 text-[#FAF8F2]">
                <p className="text-xs text-[#CAD6C4]">오늘도 안전한 이동 되세요</p>
                <h1 className="text-lg font-black mt-1">무장애 경로 탐색</h1>
            </div>

            <BusStopPanel isVisuallyImpaired={isVisuallyImpaired} />

            <div className="bg-white rounded-2xl border border-[#E5E0D0] p-4 space-y-3">
                <div className="flex gap-2">
                    <button
                        onClick={() => setTravelMode("walk")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold cursor-pointer transition ${travelMode === "walk" ? "bg-[#5E7153] text-white" : "bg-[#F4F7F1] text-[#3B4734]"
                            }`}
                    >
                        <Footprints className="w-4 h-4" />
                        도보로 가기
                    </button>
                    <button
                        onClick={() => setTravelMode("transit")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold cursor-pointer transition ${travelMode === "transit" ? "bg-[#5E7153] text-white" : "bg-[#F4F7F1] text-[#3B4734]"
                            }`}
                    >
                        <Bus className="w-4 h-4" />
                        버스 타고 가기
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 border border-[#DDD7C6] rounded-xl px-3 py-2.5">
                        <MapPin className="w-4 h-4 text-[#5E7153]" />
                        <input
                            value={originText}
                            onChange={(e) => {
                                setOriginText(e.target.value);
                                setOriginGeo(null);
                            }}
                            placeholder="출발지 입력"
                            className="w-full text-sm outline-none"
                        />
                    </div>
                    <button
                        onClick={handleUseCurrentLocation}
                        disabled={locating || !sdkReady}
                        className="flex items-center gap-1 px-3 py-2.5 rounded-xl border border-[#DDD7C6] text-xs font-bold text-[#38502C] bg-[#F4F7F1] hover:bg-[#EEF2E9] disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                        {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
                        현재 위치
                    </button>
                </div>

                <div className="flex items-center gap-2 border border-[#DDD7C6] rounded-xl px-3 py-2.5">
                    <Navigation className="w-4 h-4 text-[#5E7153]" />
                    <input
                        value={destinationText}
                        onChange={(e) => setDestinationText(e.target.value)}
                        placeholder="도착지 입력"
                        className="w-full text-sm outline-none"
                    />
                </div>

                {travelMode === "walk" && (
                    <div className="flex gap-3 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={avoidStairs} onChange={(e) => setAvoidStairs(e.target.checked)} />
                            계단 제외
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={avoidSlopes} onChange={(e) => setAvoidSlopes(e.target.checked)} />
                            급경사 제외
                        </label>
                    </div>
                )}

                <button
                    onClick={handleSearch}
                    disabled={!sdkReady || loading}
                    className="w-full bg-[#5E7153] text-white py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {loading ? "경로 탐색 중..." : "무장애 경로 찾기"}
                </button>

                {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            {sdkReady && (originGeo || destGeo || mapPolylines.length > 0) && (
                <div className="bg-white rounded-2xl border border-[#E5E0D0] p-3">
                    <RouteMapView origin={originGeo} destination={destGeo} polylines={mapPolylines} />
                </div>
            )}

            {travelMode === "walk" && walkRoute && (
                <div className="bg-white rounded-2xl border border-[#E5E0D0] p-4 space-y-3">
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
                            시각장애인 모드: 화면 안내가 음성으로도 함께 제공됩니다.
                        </p>
                    )}

                    <button
                        onClick={() => setNavigatingWalk(true)}
                        className="w-full bg-[#242F20] text-white py-3 rounded-xl text-sm font-bold cursor-pointer"
                    >
                        실시간 경로 안내 시작
                    </button>
                </div>
            )}

            {travelMode === "transit" && transitRoute && (
                <TransitSummaryCard result={transitRoute} onStartNavigation={() => setNavigatingTransit(true)} />
            )}
        </div>
    );
};

// ============================================================
// 12. 최상위 App
// ============================================================
export default function App() {
    const [user, setUser] = useState<AppUser | null>(null);

    if (!user) {
        return <LoginPage onLogin={setUser} />;
    }

    return <RouteSearchPage user={user} />;
}