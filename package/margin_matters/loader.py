import pandas as pd

URL = "https://eigentaylor.github.io/margin-matters/presidential_margins.csv"

def load():
    return pd.read_csv(URL)
