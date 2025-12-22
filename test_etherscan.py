import requests
from pathlib import Path

# ====== KONFİG ======

API_KEY = "CK1HX11UVHPNJ2VSYS5FNEX3YRDHKRV1EK"  # tırnak içinde
CONTRACT = "0xF8D253f0926b7C1fa8594c1bFD24fdbfC93B6476"
STAKED_SIG = "0xb4caaf29adda3eefee3ad552a8e85058589bf834c7466cae4ee58787f70589ed"

# Plan ID -> gün
PLAN_DAYS = {
    1: 30,
    2: 90,
    3: 180,
    4: 360,
}

# ---- Cüzdan filtresi (data_check.txt) ----
# data_check.txt aynı klasörde olacak, her satırda 1 adres:
# 0xabc...
# 0xdef...
USE_WALLET_FILTER = True           # data_check.txt'yi aktif kullan
FILTER_MODE = "exclude"            # listedekileri listeden çıkar
WALLET_FILTER_FILE = "data_check.txt"


def load_wallet_filter(path: str) -> set[str]:
    wallets: set[str] = set()
    file_path = Path(__file__).with_name(path)
    if not file_path.exists():
        print(f"[UYARI] Cüzdan filtresi dosyası bulunamadı: {file_path} (filtre pasif sayılacak)")
        return wallets

    with file_path.open("r") as f:
        total_lines = 0
        nonempty_lines = 0
        for line in f:
            total_lines += 1
            addr = line.strip().replace("\ufeff", "")
            if not addr:
                continue
            nonempty_lines += 1
            addr = addr.lower()
            if not addr.startswith("0x"):
                addr = "0x" + addr
            wallets.add(addr)

    print(f"[INFO] Cüzdan filtresi dosyası: {file_path.resolve()}")
    print(f"[INFO] Toplam satır: {total_lines}, boş olmayan satır: {nonempty_lines}, sete eklenen adres: {len(wallets)}")
    
    return wallets


WALLET_FILTER_SET: set[str] = load_wallet_filter(WALLET_FILTER_FILE) if USE_WALLET_FILTER else set()

# ====== API TEMEL PARAM ======

url = "https://api.etherscan.io/v2/api"

base_params = {
    "chainid": 1,
    "module": "logs",
    "action": "getLogs",
    "address": CONTRACT,
    "fromBlock": 0,
    "toBlock": "latest",
    "topic0": STAKED_SIG,
    "offset": 1000,     # sayfa başına max 1000 log çekelim
    "apikey": API_KEY,
}

# ====== TÜM SAYFALARI ÇEK ======

all_logs = []
page = 1

while True:
    params = dict(base_params)
    params["page"] = page

    resp = requests.get(url, params=params)
    data = resp.json()

    print(f"page {page} -> status:", data.get("status"), "-", data.get("message"))

    if data.get("status") != "1":
        # Hata varsa direkt gösterip çık
        print("[HATA] API hata döndürdü, response:")
        print(data)
        break

    logs_page = data.get("result", [])
    if not logs_page:
        # artık log yok, döngü bitti
        break

    print("  Bu sayfadaki log sayısı:", len(logs_page))
    all_logs.extend(logs_page)
    page += 1

print("\nToplam çekilen log sayısı:", len(all_logs))

# ====== PLANLARA GÖRE AYIR ======

# Her plan için ayrı liste tut
stakers_by_plan = {pid: [] for pid in PLAN_DAYS.keys()}

# Bizde olan (data_check.txt içindeki) cüzdanları ayrıca takip et
our_stakers_by_plan = {pid: [] for pid in PLAN_DAYS.keys()}

for log in all_logs:
    topics = log.get("topics", [])
    if len(topics) < 2:
        continue

    data_hex = log.get("data", "0x")[2:]  # '0x' kısmını at

    # 3 adet 32 byte = 64 hex karakter; yeterli uzunluk yoksa atla
    if len(data_hex) < 64 * 3:
        continue

    amount_token = int(data_hex[0:64], 16)
    plan_id = int(data_hex[64:128], 16)
    timestamp = int(data_hex[128:192], 16)

    # Sadece tanımlı planId'leri al (1,2,3,4)
    if plan_id not in PLAN_DAYS:
        continue

    # user adresi (topic1'in son 40 hex'i)
    user = "0x" + topics[1][-40:]
    user_norm = user.lower()

    # Bu adres data_check.txt içindeki listede mi?
    in_filter = USE_WALLET_FILTER and WALLET_FILTER_SET and user_norm in WALLET_FILTER_SET

    # Eğer bizde olan (data_check.txt'de bulunan) bir cüzdansa, ayrı listeye ekle
    if in_filter:
        our_stakers_by_plan[plan_id].append({
            "user": user,
            "amount_token": amount_token,
            "plan_id": plan_id,
            "plan_days": PLAN_DAYS.get(plan_id),
            "timestamp": timestamp,
        })

    # Cüzdan filtresi: data_check.txt'dekileri hariç tut veya sadece onları al
    if USE_WALLET_FILTER and WALLET_FILTER_SET:
        # include -> sadece listedekiler kalsın
        if FILTER_MODE == "include" and not in_filter:
            continue

        # exclude -> listedekileri at
        if FILTER_MODE == "exclude" and in_filter:
            continue

    stakers_by_plan[plan_id].append({
        "user": user,
        "amount_token": amount_token,
        "plan_id": plan_id,
        "plan_days": PLAN_DAYS.get(plan_id),
        "timestamp": timestamp,
    })

# ====== SONUÇLARI YAZDIR ======

for pid, days in PLAN_DAYS.items():
    lst = stakers_by_plan[pid]
    print(f"\nPlan {pid} ({days} gün) seçenler (toplam {len(lst)}):")
    if not lst:
        print("  (yok)")
        continue

    for s in lst:
        print(
            s["user"],
            "- amount_token:", s["amount_token"],
            "- days:", s["plan_days"],
            "- timestamp:", s["timestamp"],
        )


# ====== BİZDE OLAN CÜZDANLAR (data_check.txt) ======

print("\n=== Bizde olan cüzdanlar (data_check.txt içindekiler) ve lock'ları ===")
for pid, days in PLAN_DAYS.items():
    lst_our = our_stakers_by_plan[pid]
    print(f"\nPlan {pid} ({days} gün) - bizde olanlar (toplam {len(lst_our)}):")
    if not lst_our:
        print("  (yok)")
        continue

    for s in lst_our:
        print(
            s["user"],
            "- amount_token:", s["amount_token"],
            "- days:", s["plan_days"],
            "- timestamp:", s["timestamp"],
        )

# ====== FAZLADAN / STAKE ETMEYEN CÜZDAN KONTROLÜ ======

# data_check.txt'deki tüm cüzdanlar
all_wallets_in_file = set(WALLET_FILTER_SET)

# Gerçekten stake etmiş (event'i yakalanmış) bizde olan cüzdanlar
staked_wallets = set()
for pid, lst in our_stakers_by_plan.items():
    for s in lst:
        staked_wallets.add(s["user"].lower())

print("\n=== DEBUG: WALLET KARŞILAŞTIRMA ===")
print("data_check.txt toplam cüzdan:", len(all_wallets_in_file))
print("stake etmiş bizde olan cüzdan:", len(staked_wallets))

not_staked_wallets = all_wallets_in_file - staked_wallets

if not not_staked_wallets:
    print("✔ Tüm cüzdanlar stake etmiş.")
else:
    print("❌ Stake ETMEMİŞ cüzdan(lar):")
    for w in not_staked_wallets:
        print("➡", w)
