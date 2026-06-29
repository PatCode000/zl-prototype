using UnityEngine;

public class RenderNodeController : MonoBehaviour
{
    [Header("Scene objects")]
    [SerializeField] private Renderer carRenderer;
    [SerializeField] private Transform carTransform;

    [Header("Animation")]
    [SerializeField] private bool rotate = true;
    [SerializeField] private float rotationSpeed = 20f;

    private void Update()
    {
        if (rotate && carTransform != null)
        {
            carTransform.Rotate(0f, rotationSpeed * Time.deltaTime, 0f);
        }
    }

    public void SetRed()
    {
        SetColor("red");
    }

    public void SetBlue()
    {
        SetColor("blue");
    }

    public void SetBlack()
    {
        SetColor("black");
    }

    public void SetWhite()
    {
        SetColor("white");
    }

    public void ToggleRotation()
    {
        rotate = !rotate;
        Debug.Log($"Rotation enabled: {rotate}");
    }

    public void RotateLeft()
    {
        if (carTransform == null) return;

        carTransform.Rotate(0f, -30f, 0f);
        Debug.Log("Rotated left");
    }

    public void RotateRight()
    {
        if (carTransform == null) return;

        carTransform.Rotate(0f, 30f, 0f);
        Debug.Log("Rotated right");
    }

    private void SetColor(string color)
    {
        if (carRenderer == null)
        {
            Debug.LogWarning("Car renderer is not assigned.");
            return;
        }

        Color selectedColor = Color.white;

        switch (color.ToLowerInvariant())
        {
            case "red":
                selectedColor = Color.red;
                break;

            case "blue":
                selectedColor = Color.blue;
                break;

            case "black":
                selectedColor = Color.black;
                break;

            case "white":
                selectedColor = Color.white;
                break;

            default:
                Debug.LogWarning($"Unknown color: {color}");
                break;
        }

        carRenderer.material.color = selectedColor;

        Debug.Log($"Car color changed to: {color}");
    }
}
