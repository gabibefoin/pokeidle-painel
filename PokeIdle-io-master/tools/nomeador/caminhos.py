"""Caminhos padrão da máquina de dev. Sobrescreva com env SPRITES_RAIZ, POKEDEX_BACKUP."""
import os
from pathlib import Path


def _home() -> Path:
    return Path(os.environ.get("USERPROFILE") or Path.home())


def desktop() -> Path:
    return _home() / "Desktop"


def sprites_raiz() -> Path:
    return Path(os.environ.get("SPRITES_RAIZ", _home() / "Desktop" / "Sprites"))


def pokedex_backup() -> Path:
    return Path(os.environ.get("POKEDEX_BACKUP", desktop() / "Pokedex Backup"))


def poke_idle_backups() -> Path:
    return Path(os.environ.get("POKE_IDLE_BACKUPS", desktop() / "POKE IDLE BACKUPS"))


def lab_index() -> Path:
    return sprites_raiz() / "LAB" / "lab-index.json"
