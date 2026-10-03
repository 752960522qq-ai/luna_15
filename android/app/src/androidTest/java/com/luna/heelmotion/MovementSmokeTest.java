package com.luna.heelmotion;

import android.content.Intent;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.app.Instrumentation;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real WebView, packaged textures, native touch input, and both animation states. */
@RunWith(AndroidJUnit4.class)
public final class MovementSmokeTest {
    private MainActivity activity;
    private WebView webView;
    private Instrumentation getInstrumentation() { return InstrumentationRegistry.getInstrumentation(); }

    private String evaluate(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        String[] value = {null};
        getInstrumentation().runOnMainSync(() -> webView.evaluateJavascript(expression, result -> {
            value[0] = result;
            done.countDown();
        }));
        assertTrue("WebView callback timed out", done.await(60, TimeUnit.SECONDS));
        return value[0];
    }
    private JSONObject object(String expression) throws Exception {
        String result = evaluate("JSON.stringify(" + expression + ")");
        return new JSONObject(new JSONArray("[" + result + "]").getString(0));
    }
    private JSONObject snapshot() throws Exception {
        return object("window.__heelMotionSnapshot ? window.__heelMotionSnapshot() : {loaded:false}");
    }
    private JSONObject waitFor(String state, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        JSONObject value = null;
        do {
            value = snapshot();
            if (value.optBoolean("loaded") && state.equals(value.optString("state"))) return value;
            SystemClock.sleep(200);
        } while (SystemClock.uptimeMillis() < end);
        fail("Did not reach " + state + ": " + value);
        return value;
    }
    private void waitForWeight(String clip, double minimum, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        JSONObject value = null;
        do {
            value = snapshot();
            JSONObject weights = value.optJSONObject("weights");
            if (weights != null && weights.optDouble(clip) >= minimum) return;
            SystemClock.sleep(200);
        } while (SystemClock.uptimeMillis() < end);
        fail("Animation weight did not reach " + minimum + " for " + clip + ": " + value);
    }
    private float[] point(String element, double yFraction) throws Exception {
        JSONObject rect = object("(()=>{const r=document.getElementById('" + element
            + "').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*"
            + yFraction + ",width:innerWidth};})()");
        int[] origin = new int[2];
        int[] width = new int[1];
        getInstrumentation().runOnMainSync(() -> {
            webView.getLocationOnScreen(origin);
            width[0] = webView.getWidth();
        });
        double scale = width[0] / rect.getDouble("width");
        return new float[]{origin[0] + (float)(rect.getDouble("x") * scale),
            origin[1] + (float)(rect.getDouble("y") * scale)};
    }
    private void touch(long start, int action, float[] xy) {
        MotionEvent event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action,
            xy[0], xy[1], 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        getInstrumentation().sendPointerSync(event);
        event.recycle();
    }
    private void secondTouch(long start, int action, float[] first, float[] second) {
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[2];
        MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[2];
        for (int i = 0; i < 2; i++) {
            properties[i] = new MotionEvent.PointerProperties();
            properties[i].id = i;
            properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i] = new MotionEvent.PointerCoords();
            float[] xy = i == 0 ? first : second;
            coordinates[i].x = xy[0]; coordinates[i].y = xy[1];
            coordinates[i].pressure = 1; coordinates[i].size = .15f;
        }
        MotionEvent event = MotionEvent.obtain(start, SystemClock.uptimeMillis(),
            action | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, properties, coordinates,
            0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        getInstrumentation().sendPointerSync(event);
        event.recycle();
    }

    @Test public void testOfflineWalkRunAndRelease() throws Exception {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.setClassName(getInstrumentation().getTargetContext(), MainActivity.class.getName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("diagnostics", true);
        activity = (MainActivity)getInstrumentation().startActivitySync(intent);
        getInstrumentation().runOnMainSync(() -> webView = activity.getTestWebView());
        try {
            JSONObject initial = waitFor("待机", 120000);
            assertEquals("Four animation clips loaded", 4, initial.getJSONArray("animations").length());
            assertEquals("Closer third-person camera", 3.5, initial.getDouble("cameraDistance"), .001);
            assertTrue("WebGL2 renderer running", initial.getInt("frames") > 0);
            assertEquals("Model loaded through offline HTTPS assets", "appassets.androidplatform.net",
                initial.getString("host"));
            float[] center = point("joystick", .5);
            float[] forward = point("joystick", .16);
            long start = SystemClock.uptimeMillis();
            touch(start, MotionEvent.ACTION_DOWN, center);
            touch(start, MotionEvent.ACTION_MOVE, forward);
            JSONObject walking = waitFor("走路", 20000);
            assertTrue("Joystick walk has speed", walking.getDouble("speed") > .035);
            float[] runButton = point("run", .5);
            secondTouch(start, MotionEvent.ACTION_POINTER_DOWN, forward, runButton);
            SystemClock.sleep(100);
            secondTouch(start, MotionEvent.ACTION_POINTER_UP, forward, runButton);
            JSONObject running = waitFor("跑步", 20000);
            assertTrue("Second finger toggles running while joystick held", running.getBoolean("running"));
            assertTrue("Running exceeds walking speed", running.getDouble("speed") > .95);
            JSONObject position = running.getJSONObject("position");
            assertTrue("Character translates", Math.hypot(position.getDouble("x"),
                position.getDouble("z")) > .05);
            touch(start, MotionEvent.ACTION_UP, forward);
            JSONObject stopped = waitFor("待机", 20000);
            assertTrue("Release clears movement", stopped.getDouble("speed") < .035);
            float[] aimButton = point("aim", .5);
            long aimStart = SystemClock.uptimeMillis();
            touch(aimStart, MotionEvent.ACTION_DOWN, aimButton);
            touch(aimStart, MotionEvent.ACTION_UP, aimButton);
            JSONObject aiming = waitFor("瞄准待机", 20000);
            assertTrue("Native touch selects rifle aim idle", aiming.getBoolean("aiming"));
            waitForWeight("Rifle_Aim_Idle", .99, 20000);
            assertTrue("Aim clip receives the stationary weight",
                snapshot().getJSONObject("weights").getDouble("Rifle_Aim_Idle") > .99);
            evaluate("document.getElementById('foot-view').click()");
            assertTrue("Foot view control", snapshot().getBoolean("footView"));
            evaluate("document.getElementById('foot-view').click();document.getElementById('reset').click()");
            JSONObject reset = snapshot();
            assertFalse("Reset returns walking mode", reset.getBoolean("running"));
            assertFalse("Reset clears aim selection", reset.getBoolean("aiming"));
            assertEquals(0, reset.getJSONObject("position").getDouble("x"), .001);
            assertEquals(0, reset.getJSONObject("position").getDouble("z"), .001);
            Bitmap bitmap = getInstrumentation().getUiAutomation().takeScreenshot();
            assertNotNull("Rendered screenshot", bitmap);
            File file = new File(getInstrumentation().getTargetContext().getFilesDir(), "test-preview.png");
            try (FileOutputStream stream = new FileOutputStream(file)) {
                assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
            }
            bitmap.recycle();
        } finally {
            Bitmap diagnostic = getInstrumentation().getUiAutomation().takeScreenshot();
            if (diagnostic != null) {
                File file = new File(getInstrumentation().getTargetContext().getFilesDir(), "test-preview.png");
                try (FileOutputStream stream = new FileOutputStream(file)) {
                    diagnostic.compress(Bitmap.CompressFormat.PNG, 100, stream);
                }
                diagnostic.recycle();
            }
            getInstrumentation().runOnMainSync(() -> activity.finish());
        }
    }
}
