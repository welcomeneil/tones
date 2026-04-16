from fastapi import FastAPI, UploadFile, File
from fastapi.params import Form
from pipeline import run_pipeline

app = FastAPI()

@app.post("/analyze")
async def analyze(file: UploadFile = File(...), sigma: float = Form(...)):
    contents = await file.read()
    tonal_zones, palette, boundaries = run_pipeline(contents, sigma)
    return {
        "tonal_zones": tonal_zones.tolist(),
        "palette": palette,
        "boundaries": boundaries.tolist()
    }


# zone_nums, palette, valleys = run_pipeline('bust.jpg', sigma=2.0)

# print('zones:', zone_nums)
# print('palette:', palette)
# print('valleys:', valleys)