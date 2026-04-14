import numpy as np
import matplotlib.pyplot as plt
from PIL import Image
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

# Convert the original RGB image to grayscale
def rgb_to_grayscale(img):
    img = Image.open(img)
    grayscale_img = img.convert('L')
    return grayscale_img

# Flatten the image into a 1D array, since the 2D representation is negligible
def flatten_image(img):
    img_array = np.array(img)
    flat_1d = img_array.flatten()
    return flat_1d

# combination of rgb_to_grayscale and flatten_image
def load_and_preprocess_image(path):
    grayscale_img = rgb_to_grayscale(path)
    flat_1d = flatten_image(grayscale_img)
    return flat_1d

# Calculate the histogram of the image
def histogram_of_image(flat_1d):
    hist = np.histogram(flat_1d, bins=256)
    return hist

grayscale_img = rgb_to_grayscale('ship.jpeg')
grayscale_array = np.array(grayscale_img)

processed_img = load_and_preprocess_image('ship.jpeg')
counts, bin_edges = histogram_of_image(processed_img)
smoothed_counts = gaussian_filter1d(counts, sigma=5)
valleys, _ = find_peaks(-smoothed_counts)

zone_nums = np.digitize(grayscale_array, bins=valleys)

zones = np.unique(zone_nums)
palette = [round(np.mean(grayscale_array[zone_nums == zone])) for zone in zones]

palette_img = np.array([[shade] * 50 for shade in palette], dtype=np.uint8)
plt.imshow(palette_img, cmap='gray', vmin=0, vmax=255)
plt.axis('off')
plt.show()

# print(valleys)
# print(palette)
# plt.imshow(zone_nums)
# plt.show()





# plt.plot(smoothed_counts)

# 1: 60
# 1.5: 33
# 2: 14
# 2.5: 6
# 3: 5 , [ 80  96 109 125 145]
# 3.5: 5, [ 80  95 109 124 145]
# 4: 5, [ 80  95 109 124 145]
# 4.5: 3, [ 80 109 146]
# 5: 3, [ 79 108 146]
# 5.5: 2, [ 108 146]
# 6: 2, [ 107 146]