# workers/tasks.py
from extensions import celery

# AI schedule generation is no longer a background job that saves shifts: the
# AI Schedule Copilot (POST /ai/schedule/generate) returns validated recommendations
# and only POST /ai/schedule/apply — a manager's explicit action — creates drafts.


@celery.task(bind=True, max_retries=3)
def run_staffing_prediction_task(self, location_id, target_week, manager_user_id):
    from ai.client import AIBadResponse, AINotConfigured
    from services.ai_service import AIService
    from services.notification_service import NotificationService
    from utils.socket_events import emit_ai_prediction

    try:
        prediction = AIService().predict_staffing(location_id=location_id, target_week=target_week)
    except (AINotConfigured, AIBadResponse) as exc:
        # Retrying won't fix a missing key or an unusable answer.
        return {"error": exc.message, "code": exc.code, "location_id": location_id}
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)

    emit_ai_prediction(location_id, prediction)
    NotificationService().create(
        user_id=manager_user_id,
        notif_type="ai_prediction_ready",
        title="Staffing Prediction Ready",
        body=f"AI staffing forecast for {target_week} is available.",
        data={"prediction": prediction},
    )
    return prediction
