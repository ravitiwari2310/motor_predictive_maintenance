import math
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="PMSM Thermal Digital Twin Engine",
    description="Real-Time Thermal Inference Backend with Input Field Validation"
)

# Enable CORS for browser frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TelemetryPayload(BaseModel):
    # Thermal Sensors (°C) - Mandatory fields with bounds matching HTML range sliders
    stator_winding: float = Field(
        ..., ge=0.0, le=200.0, 
        description="Stator winding temperature in °C", 
        examples=[65.5]
    )
    stator_tooth: float = Field(
        ..., ge=0.0, le=200.0, 
        description="Stator tooth temperature in °C", 
        examples=[60.2]
    )
    stator_yoke: float = Field(
        ..., ge=0.0, le=200.0, 
        description="Stator yoke temperature in °C", 
        examples=[55.1]
    )
    coolant: float = Field(
        ..., ge=-20.0, le=150.0, 
        description="Coolant inlet temperature in °C", 
        examples=[30.0]
    )
    pm: float = Field(
        ..., ge=0.0, le=200.0, 
        description="Permanent Magnet temperature in °C", 
        examples=[58.4]
    )
    ambient: float = Field(
        ..., ge=-40.0, le=80.0, 
        description="Ambient environmental temperature in °C", 
        examples=[25.0]
    )

    # Dynamics & Electrical Parameters - Mandatory fields
    motor_speed: float = Field(
        ..., ge=-8000.0, le=8000.0, 
        description="Motor rotational speed in RPM", 
        examples=[3000.0]
    )
    torque: float = Field(
        ..., ge=-300.0, le=300.0, 
        description="Mechanical torque output in Nm", 
        examples=[120.0]
    )
    i_d: float = Field(
        ..., ge=-300.0, le=300.0, 
        description="Direct-axis current in Amperes", 
        examples=[-100.0]
    )
    i_q: float = Field(
        ..., ge=-300.0, le=300.0, 
        description="Quadrature-axis current in Amperes", 
        examples=[150.0]
    )
    u_d: float = Field(
        ..., ge=-200.0, le=200.0, 
        description="Direct-axis voltage in Volts", 
        examples=[-40.0]
    )
    u_q: float = Field(
        ..., ge=-200.0, le=200.0, 
        description="Quadrature-axis voltage in Volts", 
        examples=[80.0]
    )

@app.get("/")
def health_check():
    """Health check endpoint used by frontend status badge."""
    return {"status": "online", "message": "PMSM Thermal Engine operational"}

@app.post("/predict")
def predict_temperature(payload: TelemetryPayload):
    """
    Inference endpoint: Computes +60s predicted stator winding temperature,
    thermal status classification, anomaly state, and confidence score.
    """
    # Physics-informed thermal dissipation & loss estimation
    i_magnitude = math.sqrt(payload.i_d**2 + payload.i_q**2)
    joule_losses = 0.00045 * (i_magnitude**2)
    speed_rad_s = (abs(payload.motor_speed) * 2 * math.pi) / 60.0
    mechanical_power_factor = (abs(payload.torque) * speed_rad_s) / 12000.0
    
    coolant_heat_removal = (payload.stator_winding - payload.coolant) * 0.04
    thermal_delta = (joule_losses + mechanical_power_factor) - coolant_heat_removal

    predicted_temp = round(payload.stator_winding + thermal_delta, 2)

    # Threshold status evaluation
    if predicted_temp >= 110.0:
        status = "CRITICAL_OVERHEAT_WARNING"
    elif predicted_temp >= 90.0:
        status = "ELEVATED_TEMPERATURE"
    else:
        status = "NORMAL"

    # Anomaly detection & confidence scoring
    anomaly = bool(abs(payload.i_q) > 270 or predicted_temp > 115.0)
    confidence = round(max(0.88, 0.99 - (abs(payload.motor_speed) / 120000.0)), 2)

    return {
        "current_temp": payload.stator_winding,
        "predicted_temp": predicted_temp,
        "status": status,
        "anomaly": anomaly,
        "confidence": confidence
    }