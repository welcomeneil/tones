from pipeline import run_pipeline

zone_nums, palette, valleys = run_pipeline('bust.jpg', sigma=2.0)

print('zones:', zone_nums)
print('palette:', palette)
print('valleys:', valleys)