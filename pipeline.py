from io import BytesIO
from PIL import Image
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

def load_image(image_bytes):
    return Image.open(BytesIO(image_bytes))

def img_to_grayscale(img):
    return img.convert('L')

def flatten_pixels(grayscale_img):
    return np.array(grayscale_img).flatten()

def compute_luminosity_histogram(flat_pixels):
    counts, bin_edges = np.histogram(flat_pixels, bins=256)
    return counts, bin_edges

def smooth_luminosity_curve(counts, sigma):
    return gaussian_filter1d(counts, sigma=sigma)

def find_tonal_boundaries(smoothed_curve):
    boundaries, _ = find_peaks(-smoothed_curve)
    return boundaries

def assign_tonal_zones(grayscale_img_array, boundaries):
    return np.digitize(grayscale_img_array, bins=boundaries)

def build_tonal_palette(grayscale_img_array, tonal_zones):
    zones = np.unique(tonal_zones)
    return [round(np.mean(grayscale_img_array[tonal_zones == zone])) for zone in zones]

def run_pipeline(path, sigma=2.0):
    img = load_image(path)
    grayscale_img = img_to_grayscale(img)
    grayscale_img_array = np.array(grayscale_img)
    
    flat_pixels = flatten_pixels(grayscale_img)
    counts, _ = compute_luminosity_histogram(flat_pixels)
    smoothed_curve = smooth_luminosity_curve(counts, sigma)
    boundaries = find_tonal_boundaries(smoothed_curve)
    tonal_zones = assign_tonal_zones(grayscale_img_array, boundaries)
    palette = build_tonal_palette(grayscale_img_array, tonal_zones)
    
    return tonal_zones, palette, boundaries
