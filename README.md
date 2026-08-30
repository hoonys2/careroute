# 무장애 맞춤형 이동경로 안내 서비스 (CareRoute)

휠체어 이용자, 고령자, 유모차 동반자, 시각장애인, 보행약자를 위한 맞춤형 무장애 보행 및 대중교통(저상버스) 실시간 경로 안내 웹 애플리케이션입니다.

---

## 🚀 주요 기능
- **이용자 맞춤형 모드**: 휠체어, 고령자, 유모차, 시각장애인, 보행약자별 맞춤 알고리즘
- **카카오 지도 연동**: 출발지/도착지 장소 검색, 지오코딩 및 경로 시각화
- **Tmap 보행자/대중교통 경로**: 계단/급경사 회피 보행자 경로 및 대중교통 최적 경로 탐색
- **공공데이터포털(TAGO) 실시간 버스 정보**: 현재 위치 기반 주변 정류장 탐색 및 저상버스 실시간 도착 정보
- **실시간 화살표 & 카메라 안내**: 후면 카메라 화면 + 실시간 나침반 방향 안내 + 한국어 음성(TTS) 가이드
- **런타임 설정 모달**: 화면 상단 ⚙ 아이콘을 통해 브라우저에서 직접 API 키 입력/저장 가능

---

## 🌐 Netlify 배포 가이드

### 1. Netlify 환경 변수 설정
Netlify 대시보드의 **[Site configuration] > [Environment variables]**에서 다음 변수들을 등록합니다:

| 변수명 | 설명 | 발급처 |
| :--- | :--- | :--- |
| `VITE_KAKAO_JS_KEY` | 카카오 지도 JavaScript 키 | [Kakao Developers](https://developers.kakao.com) |
| `VITE_TMAP_APP_KEY` | TMAP OpenAPI 앱 키 | [SK OpenAPI](https://openapi.sk.com) |
| `VITE_TAGO_API_KEY` | 공공데이터포털 일반 인증키 (Decoding 또는 Encoding) | [공공데이터포털](https://www.data.go.kr) |

### 2. 카카오 개발자 콘솔 Web 도메인 등록 (필수 ⚠️)
지도가 정상 표시되려면 Kakao Developers 콘솔에서 도메인을 등록해야 합니다:
1. [Kakao Developers](https://developers.kakao.com) 접속 후 내 애플리케이션 선택
2. **[앱 설정] > [플랫폼] > [Web]** 클릭
3. **사이트 도메인**에 배포된 Netlify 주소 및 로컬 주소 등록:
   - `https://your-app-name.netlify.app`
   - `http://localhost:3000` (로컬 테스트용)

### 3. Netlify 빌드 설정
- **Build command**: `npm run build`
- **Publish directory**: `dist`
- *(프로젝트에 포함된 `netlify.toml`과 `public/_redirects` 파일이 API 프록시와 SPA 라우팅을 자동으로 처리합니다)*

---

## 💻 로컬 개발 환경 실행

```bash
# 1. 패키지 설치
npm install

# 2. .env 파일 생성 및 API 키 설정 (.env.example 참고)

# 3. 개발 서버 실행
npm run dev
```
