# OPIc 트레이너

OPIc 학원 자료(워드 스크립트 + 선생님 녹음)를 폰에서 복습하는 개인용 PWA.

**앱 주소: https://hatae87-gif.github.io/opic-trainer/**

앱 코드를 고친 뒤 다시 배포하려면:
```
npm run build --workspace=app
npx gh-pages -d app/dist --nojekyll
```

## 매주 새 수업 자료가 오면

1. 학원 자료를 `C:\Users\hatae\Documents\Claude\Opic 1등급 도전\DAY{N}(날짜)\` 폴더에 넣는다 (zip 그대로 둬도 됨)
2. 이 폴더에서 실행:
   ```
   npm run prep
   ```
3. `prep\output\opic-날짜.opicpack` 파일이 생긴다 → 카톡 "나에게 보내기"로 폰에 전송
4. 폰에서 앱 열기 → **자료 가져오기** → 받은 파일 선택

기존 학습 기록(복습 주기·녹음)은 재가져오기해도 유지된다.

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run prep` | 자료 스캔 → 워드 파싱 → 문장 분할 → Whisper 구간 정렬 → 번들 생성 |
| `npm run prep -- --dry` | 파싱 결과만 확인 (API 호출 없음) |
| `npm run dev --workspace=app` | PC 브라우저에서 앱 실행 (http://localhost:5173) |
| `npm run build --workspace=app` | 배포용 빌드 |

## 준비물

- `prep\.env` 에 OpenAI API 키 (문장별 구간 정렬에 사용, 회당 수백 원 미만):
  ```
  OPENAI_API_KEY=sk-...
  ```
- 키가 없어도 번들은 만들어지지만 문장별 재생이 안 되고 전체 재생만 된다.
- Whisper 인식 결과는 `prep\.cache\` 에 저장되어 같은 오디오는 다시 과금되지 않는다.

## 폰 설치 (안드로이드)

1. 배포된 주소를 Chrome으로 열기
2. 메뉴(⋮) → **홈 화면에 추가**
3. 이후 오프라인에서도 동작 (자료는 폰 안에만 저장, 서버에 올라가지 않음)
